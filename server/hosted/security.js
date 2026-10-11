/** Hosted deployment configuration is explicit; forwarding headers grant no trust. */
export function hostedConfiguration(environment = process.env) {
  const value =
    environment.GEV_PUBLIC_ORIGIN || environment.RENDER_EXTERNAL_URL;
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('Set GEV_PUBLIC_ORIGIN to the public HTTPS origin.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== value ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      'GEV_PUBLIC_ORIGIN must be an exact HTTPS origin without a trailing slash.',
    );
  }
  const password = environment.GEV_ACCESS_PASSWORD;
  if (
    typeof password !== 'string' ||
    password.length < 20 ||
    password.length > 1024
  ) {
    throw new Error('GEV_ACCESS_PASSWORD must contain 20–1024 characters.');
  }
  const port = Number(environment.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const bindHost = environment.GEV_BIND_HOST || '0.0.0.0';
  if (!['127.0.0.1', '0.0.0.0'].includes(bindHost)) {
    throw new Error('GEV_BIND_HOST must be 127.0.0.1 or 0.0.0.0.');
  }
  return Object.freeze({
    publicOrigin: origin.origin,
    publicHost: origin.host,
    password,
    port,
    bindHost,
  });
}

export function requestPath(req) {
  const raw = req.url || '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 16384)
    return null;
  const rawPath = raw.split('?')[0];
  try {
    const decoded = decodeURIComponent(rawPath);
    // Check before WHATWG URL normalization, which would erase dot segments.
    if (/[\\\x00-\x1f\x7f#]/.test(decoded)) return null;
    if (decoded.split('/').some((part) => part.startsWith('.'))) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function sameOriginRequest(req, publicOrigin, { api = false } = {}) {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  if (origin !== undefined && origin !== publicOrigin) return false;
  if (!['GET', 'HEAD'].includes(req.method)) return origin === publicOrigin;
  // Cost-bearing GET APIs must come from this app. A missing Origin is only
  // accepted with the browser's same-origin Fetch Metadata, never a navigation.
  if (api && origin === undefined) return site === 'same-origin';
  return true;
}

export function unavailableHostedPath(path, req) {
  const lower = path.toLowerCase();
  if (
    /^\/api\/setup(?:\/|$)/.test(lower) ||
    /^\/mcp(?:\/|$)/.test(lower) ||
    /^\/api\/local-receivers(?:\/|$)/.test(lower) ||
    /^\/api\/realtime\/(?:oauth[^/]*|debug-log)(?:\/|$)/.test(lower)
  )
    return true;
  if (/^\/api\/realtime\/token(?:\/|$)/.test(lower)) {
    const query = new URL(req.url, 'https://host.invalid').searchParams;
    // Default is API key; do not permit any OAuth lane, even duplicate params.
    return query
      .getAll('auth')
      .some((value) => value.toLowerCase() !== 'api-key');
  }
  return false;
}

export function jsonResponse(req, res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(payload));
}

// The upstream browser policy also permits plain ws: for localhost receivers.
// Hosted mode uses TLS-only connections and disables those receiver endpoints.
export const HOSTED_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' blob: https://www.youtube.com https://connect.facebook.net https://platform.twitter.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' blob: data: https: wss:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.youtube.com https://www.facebook.com https://platform.twitter.com",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'private, no-store',
});
