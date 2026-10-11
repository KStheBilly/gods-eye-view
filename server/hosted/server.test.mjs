import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHostedServer } from './server.js';
import { hostedConfiguration } from './security.js';
import { sameSiteGated } from '../providers/common/same-site.js';

const origin = 'https://globe.example.com';
const password = 'test-only-password-long-enough';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gev-hosted-test-'));
  await writeFile(
    path.join(directory, 'index.html'),
    '<title>Test globe</title>',
  );
  await writeFile(path.join(directory, 'sample.txt'), '0123456789');
  let installs = 0;
  const hosted = await createHostedServer({
    environment: { GEV_PUBLIC_ORIGIN: origin, GEV_ACCESS_PASSWORD: password },
    distDir: directory,
    installProviders(server) {
      installs++;
      server.middlewares.use(
        '/api/check',
        sameSiteGated((_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ liveProviderReached: true }));
        }),
      );
      server.middlewares.use('/api/missing-key', (_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_key', keyRequired: true }));
      });
      server.middlewares.use('/api/failure', async () => {
        throw new Error('private-detail');
      });
    },
  });
  await new Promise((resolve) => hosted.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await hosted.close();
    await rm(directory, { recursive: true, force: true });
  });
  function call(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: hosted.server.address().port,
          path: url,
          method,
          headers: { Host: 'globe.example.com', ...headers },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, text }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }
  async function login(value = password, headers = {}) {
    return call('/auth/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams({ password: value }).toString(),
    });
  }
  const cookie = async () =>
    (await login()).headers['set-cookie'][0].split(';')[0];
  return { call, login, cookie, installs: () => installs };
}

test('configuration fails closed without exact HTTPS origin and a strong password', () => {
  for (const value of [
    '',
    'http://globe.example.com',
    origin + '/',
    origin + '/path',
    'https://x@y.example',
  ]) {
    assert.throws(() =>
      hostedConfiguration({
        GEV_PUBLIC_ORIGIN: value,
        GEV_ACCESS_PASSWORD: password,
      }),
    );
  }
  assert.throws(() =>
    hostedConfiguration({
      GEV_PUBLIC_ORIGIN: origin,
      GEV_ACCESS_PASSWORD: 'short',
    }),
  );
  assert.equal(
    hostedConfiguration({
      RENDER_EXTERNAL_URL: origin,
      GEV_ACCESS_PASSWORD: password,
    }).publicOrigin,
    origin,
  );
  assert.equal(
    hostedConfiguration({
      GEV_PUBLIC_ORIGIN: origin,
      GEV_ACCESS_PASSWORD: password,
      GEV_BIND_HOST: '127.0.0.1',
    }).bindHost,
    '127.0.0.1',
  );
  assert.throws(() =>
    hostedConfiguration({
      GEV_PUBLIC_ORIGIN: origin,
      GEV_ACCESS_PASSWORD: password,
      GEV_BIND_HOST: 'example.com',
    }),
  );
});

test('health and login do not initialize providers; app, assets and APIs require login', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call('/healthz', { headers: { Host: '127.0.0.1' } })).status,
    200,
  );
  assert.equal((await f.call('/healthz', { method: 'POST' })).status, 405);
  assert.equal((await f.call('/auth/login')).status, 200);
  assert.equal((await f.call('/')).headers.location, '/auth/login');
  assert.equal((await f.call('/sample.txt')).status, 303);
  assert.equal((await f.call('/api/check')).status, 401);
  assert.equal(f.installs(), 0);
});

test('password login issues a secure session; forged cookies and foreign hosts are rejected', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.login('wrong')).status, 401);
  const result = await f.login();
  assert.equal(result.status, 303);
  const setCookie = result.headers['set-cookie'][0];
  for (const part of [
    '__Host-gev-session=',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
  ])
    assert.ok(setCookie.includes(part));
  const Cookie = setCookie.split(';')[0];
  assert.match((await f.call('/', { headers: { Cookie } })).text, /Test globe/);
  assert.equal(
    (await f.call('/', { headers: { Cookie: Cookie + 'x' } })).status,
    303,
  );
  assert.equal(
    (
      await f.call('/', {
        headers: {
          Cookie,
          Host: 'evil.example',
          'X-Forwarded-Host': 'globe.example.com',
        },
      })
    ).status,
    421,
  );
});

test('same-origin authenticated providers work behind TLS termination and retain missing-key responses', async (t) => {
  const f = await fixture(t);
  const Cookie = await f.cookie();
  const headers = {
    Cookie,
    Origin: origin,
    'X-Forwarded-Proto': 'https',
    'X-Forwarded-For': '203.0.113.2',
  };
  const result = await f.call('/api/check', { headers });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.text), { liveProviderReached: true });
  assert.equal(
    (
      await f.call('/api/check', {
        headers: { Cookie, 'Sec-Fetch-Site': 'same-origin' },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    JSON.parse((await f.call('/api/missing-key', { headers })).text),
    { error: 'no_key', keyRequired: true },
  );
  assert.equal((await f.call('/api/unknown', { headers })).status, 404);
  const failure = await f.call('/api/failure', { headers });
  assert.equal(failure.status, 500);
  assert.ok(!failure.text.includes('private-detail'));
  assert.equal(f.installs(), 1);
});

test('CSRF protections reject foreign origins, missing-origin posts and navigation to APIs', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.login(password, { Origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await f.login(password, { 'Sec-Fetch-Site': 'cross-site' })).status,
    403,
  );
  const Cookie = await f.cookie();
  for (const headers of [
    { Cookie },
    { Cookie, Origin: 'null' },
    { Cookie, Origin: 'https://evil.example' },
    { Cookie, 'Sec-Fetch-Site': 'none' },
  ]) {
    assert.equal((await f.call('/api/check', { headers })).status, 403);
  }
  assert.equal(
    (
      await f.call('/api/check', {
        method: 'POST',
        headers: { Cookie, 'Sec-Fetch-Site': 'same-origin' },
      })
    ).status,
    403,
  );
  assert.equal(f.installs(), 0);
});

test('local-only routes, credential paths and traversal cannot reach providers', async (t) => {
  const f = await fixture(t);
  const headers = { Cookie: await f.cookie(), Origin: origin };
  for (const route of [
    '/api/setup/status',
    '/api/setup/keys',
    '/mcp',
    '/api/local-receivers',
    '/api/realtime/oauth-login',
    '/api/realtime/oauth-status',
    '/api/realtime/debug-log',
    '/api/realtime/token?auth=oauth',
    '/api/realtime/token?auth=api-key&auth=oauth',
    '/src/main.js',
    '/server/hosted/start.js',
    '/package.json',
  ]) {
    assert.equal((await f.call(route, { headers })).status, 404, route);
  }
  for (const route of [
    '/.env',
    '/%2eenv',
    '/foo/../package.json',
    '/foo/%2e%2e/package.json',
    '/foo%5c..%5c.env',
  ]) {
    assert.equal((await f.call(route, { headers })).status, 400, route);
  }
  assert.equal(f.installs(), 0);
});

test('static files support HEAD and ranges, and logout clears the cookie', async (t) => {
  const f = await fixture(t);
  const headers = { Cookie: await f.cookie() };
  const head = await f.call('/sample.txt', { method: 'HEAD', headers });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  const range = await f.call('/sample.txt', {
    headers: { ...headers, Range: 'bytes=2-5' },
  });
  assert.equal(range.status, 206);
  assert.equal(range.text, '2345');
  const logout = await f.call('/auth/logout', {
    method: 'POST',
    headers: { ...headers, Origin: origin },
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
});

test('upstream local same-site gate still rejects reverse-proxy headers', () => {
  let called = false;
  const req = {
    headers: { host: 'localhost', 'x-forwarded-proto': 'https' },
    socket: {},
  };
  const res = { setHeader() {}, end() {} };
  sameSiteGated(() => {
    called = true;
  })(req, res);
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});
