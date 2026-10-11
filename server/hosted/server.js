import { createServer } from 'node:http';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connect from 'connect';
import serveStatic from 'serve-static';
import { createAccessGate } from './auth.js';
import {
  HOSTED_HEADERS,
  hostedConfiguration,
  jsonResponse,
  requestPath,
  sameOriginRequest,
  unavailableHostedPath,
} from './security.js';
import { markAuthenticatedHostedRequest } from '../providers/common/same-site.js';

const DEFAULT_DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const SOURCE_PATH =
  /^\/(?:src|server|node_modules|config|build|scripts|tools|docs)(?:\/|$)|\.(?:map|env|pem|key|crt|toml|ya?ml)$|^\/(?:package(?:-lock)?\.json|vite\.config\.js)$/i;

async function defaultInstallProviders(facade) {
  const { installHostedProviders } = await import('./providers.js');
  installHostedProviders(facade);
}

async function validateDist(directory) {
  const root = await realpath(directory);
  if (!(await stat(path.join(root, 'index.html'))).isFile())
    throw new Error(
      'Build the browser application before starting the hosted server.',
    );
  // serve-static follows links. Deployment artifacts must contain real files,
  // never a link to source code or credentials outside the public build.
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('The browser build must not contain symbolic links.');
      if (entry.isDirectory()) await visit(path.join(dir, entry.name));
    }
  }
  await visit(root);
  return root;
}

function safeMiddleware(handler) {
  return function hostedProviderHandler(req, res, next) {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}

/** Create an authenticated HTTP server intended to run behind an HTTPS edge. */
export async function createHostedServer({
  environment = process.env,
  distDir = DEFAULT_DIST,
  installProviders = defaultInstallProviders,
} = {}) {
  const configuration = hostedConfiguration(environment);
  const distRoot = await validateDist(distDir);
  const access = createAccessGate(configuration);
  const middleware = connect();
  const server = createServer({ maxHeaderSize: 16384 }, middleware);
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  let closing = false;
  let providerPromise;

  const errorResponse = (req, res) => {
    if (res.headersSent) res.destroy();
    else
      jsonResponse(req, res, 500, { error: 'Request could not be completed' });
  };

  middleware.use(
    safeMiddleware(async (req, res, next) => {
      for (const [name, value] of Object.entries(HOSTED_HEADERS))
        res.setHeader(name, value);
      const pathname = requestPath(req);
      if (pathname === null) {
        jsonResponse(req, res, 400, { error: 'Invalid request path' });
        return;
      }
      if (pathname === '/healthz') {
        if (!['GET', 'HEAD'].includes(req.method)) {
          jsonResponse(req, res, 405, { error: 'Method not allowed' });
        } else {
          jsonResponse(req, res, closing ? 503 : 200, {
            status: closing ? 'unavailable' : 'ok',
          });
        }
        return;
      }
      // Health probes may address the private port directly. All application
      // requests must use the configured public Host, never a forwarded value.
      if (req.headers.host !== configuration.publicHost) {
        jsonResponse(req, res, 421, { error: 'Unrecognized host' });
        return;
      }
      if (closing) {
        jsonResponse(req, res, 503, { error: 'Service is restarting' });
        return;
      }
      if (await access.handle(req, res, pathname)) return;
      const api = /^\/api(?:\/|$)/i.test(pathname);
      if (!sameOriginRequest(req, configuration.publicOrigin, { api })) {
        jsonResponse(req, res, 403, { error: 'Request refused' });
        return;
      }
      if (unavailableHostedPath(pathname, req) || SOURCE_PATH.test(pathname)) {
        jsonResponse(req, res, 404, { error: 'Not available' });
        return;
      }
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD, POST');
        jsonResponse(req, res, 405, { error: 'Method not allowed' });
        return;
      }
      if (!api) {
        next();
        return;
      }

      markAuthenticatedHostedRequest(req, configuration.publicOrigin);
      // Lazy installation matters: AIS starts a background stream/watchdog when
      // installed. Public health probes and login pages cannot start any feed.
      providerPromise ||= (async () => {
        const providers = connect();
        const facade = {
          httpServer: server,
          middlewares: {
            use(route, handler) {
              if (typeof route === 'function')
                providers.use(safeMiddleware(route));
              else providers.use(route, safeMiddleware(handler));
            },
          },
        };
        await installProviders(facade);
        providers.use((request, response) =>
          jsonResponse(request, response, 404, {
            error: 'Unknown API endpoint',
          }),
        );
        providers.use((_error, request, response, _next) =>
          errorResponse(request, response),
        );
        return providers;
      })();
      const providers = await providerPromise;

      providers(req, res);
    }),
  );

  middleware.use(
    serveStatic(distRoot, {
      dotfiles: 'deny',
      index: 'index.html',
      redirect: false,
      fallthrough: true,
      cacheControl: false,
      acceptRanges: true,
    }),
  );
  middleware.use((req, res) =>
    jsonResponse(req, res, 404, { error: 'Not found' }),
  );
  middleware.use((_error, req, res, _next) => errorResponse(req, res));
  // Browser voice uses WebRTC directly. This server exposes no WebSocket or
  // CONNECT tunnel, including for unauthenticated clients.
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('connect', (_req, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());

  async function close() {
    if (closing) return;
    closing = true;
    const force = setTimeout(() => server.closeAllConnections(), 20_000);
    force.unref();
    await new Promise((resolve) => server.close(resolve));
    clearTimeout(force);
  }
  return {
    server,
    close,
    port: configuration.port,
    bindHost: configuration.bindHost,
  };
}
