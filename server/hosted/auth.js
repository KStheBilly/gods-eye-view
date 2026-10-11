import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { jsonResponse, sameOriginRequest } from './security.js';

const COOKIE_NAME = '__Host-gev-session';
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function loginPage(failed = false) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · God's Eye View</title><style>html{color-scheme:dark;font:16px system-ui;background:#08111c;color:#e8f2fa}body{margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(360px,calc(100vw - 64px));padding:32px;border:1px solid #274358;border-radius:16px;background:#101e2b}h1{font-size:26px}p{color:#9db3c3;line-height:1.5}label{display:block;margin-top:24px}input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:10px;border-radius:8px;border:1px solid #36576c;font:inherit}input{background:#091621;color:#fff}button{background:#8be0ca;color:#082321;font-weight:700;cursor:pointer}.error{color:#ffb4b4}</style><main><h1>God's Eye View</h1><p>Your private view of the planet.</p>${failed ? '<p class="error" role="alert">Sign-in failed. Check your password and try again.</p>' : ''}<form action="/auth/login" method="post"><label for="password">Access password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024" autofocus><button type="submit">Open my globe</button></form></main></html>`;
}

function cookie(value, seconds) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}

async function readLoginBody(req) {
  if (
    req.headers['content-type']?.split(';')[0] !==
    'application/x-www-form-urlencoded'
  )
    return null;
  if (Number(req.headers['content-length']) > 4096) return null;
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) return null;
    chunks.push(chunk);
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  return params.getAll('password').length === 1 ? params.get('password') : null;
}

export function createAccessGate({ password, publicOrigin }) {
  const signingKey = randomBytes(32);
  const passwordDigest = createHash('sha256').update(password).digest();
  let attempts = 0;
  let windowStart = Date.now();
  const sign = (payload) =>
    createHmac('sha256', signingKey).update(payload).digest('base64url');

  function authenticated(req) {
    const cookies = String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim());
    const values = cookies.filter((part) => part.startsWith(`${COOKIE_NAME}=`));
    if (values.length !== 1) return false;
    const token = values[0].slice(COOKIE_NAME.length + 1);
    if (token.length > 160) return false;
    const [expires, nonce, signature, extra] = token.split('.');
    if (
      extra ||
      !/^\d{13}$/.test(expires || '') ||
      !/^[A-Za-z0-9_-]{24}$/.test(nonce || '')
    )
      return false;
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature || '')) return false;
    const remaining = Number(expires) - Date.now();
    if (remaining <= 0 || remaining > SESSION_SECONDS * 1000) return false;
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(sign(`${expires}.${nonce}`)),
    );
  }

  async function handle(req, res, path) {
    if (path === '/auth/login') {
      if (!sameOriginRequest(req, publicOrigin)) {
        jsonResponse(req, res, 403, { error: 'Request refused' });
        return true;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : loginPage());
        return true;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, HEAD, POST');
        jsonResponse(req, res, 405, { error: 'Method not allowed' });
        return true;
      }
      if (Date.now() - windowStart >= LOGIN_WINDOW_MS) {
        windowStart = Date.now();
        attempts = 0;
      }
      // A global cap is intentional for this one-user deployment: no forwarded
      // IP supplied by a visitor can evade it or grow an unbounded address map.
      if (++attempts > 30) {
        res.setHeader(
          'Retry-After',
          String(
            Math.ceil((LOGIN_WINDOW_MS - (Date.now() - windowStart)) / 1000),
          ),
        );
        jsonResponse(req, res, 429, {
          error: 'Too many sign-in attempts. Try again later.',
        });
        return true;
      }
      const supplied = await readLoginBody(req);
      const digest = createHash('sha256')
        .update(supplied || '')
        .digest();
      if (supplied === null || !timingSafeEqual(passwordDigest, digest)) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(loginPage(true));
        return true;
      }
      attempts = 0;
      const payload = `${Date.now() + SESSION_SECONDS * 1000}.${randomBytes(18).toString('base64url')}`;
      res.setHeader(
        'Set-Cookie',
        cookie(`${payload}.${sign(payload)}`, SESSION_SECONDS),
      );
      res.writeHead(303, { Location: '/' });
      res.end();
      return true;
    }
    if (!authenticated(req)) {
      if (
        /^\/api(?:\/|$)/i.test(path) ||
        !['GET', 'HEAD'].includes(req.method)
      ) {
        jsonResponse(req, res, 401, { error: 'Sign in to continue' });
      } else {
        res.writeHead(303, { Location: '/auth/login' });
        res.end();
      }
      return true;
    }
    if (path === '/auth/logout') {
      if (req.method !== 'POST' || !sameOriginRequest(req, publicOrigin)) {
        jsonResponse(req, res, 403, { error: 'Request refused' });
        return true;
      }
      res.setHeader('Set-Cookie', cookie('', 0));
      res.writeHead(303, { Location: '/auth/login' });
      res.end();
      return true;
    }
    return false;
  }
  return { handle };
}
