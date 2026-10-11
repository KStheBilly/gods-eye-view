import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';

// Only the hosted server's authenticated request gate may grant this trust.
// Request headers cannot create an entry. Local/dev requests retain the exact
// original proxy rejection policy below.
const authenticatedHostedRequests = new WeakMap();
export function markAuthenticatedHostedRequest(req, publicOrigin) {
  authenticatedHostedRequests.set(req, publicOrigin);
}

/**
 * Cross-site request gate for cost-bearing and log endpoints. Feeds the
 * request to the pure, unit-tested `admitSameSiteRequest` and answers 403
 * itself when the request is refused. Returns true when it has already
 * responded (the caller returns); false when the handler should continue.
 * Refuses cross-site browser requests (foreign or opaque Origin, a
 * Sec-Fetch-Site other than same-origin/none, or reverse-proxy headers) while
 * keeping loopback non-browser tools and the HOST=0.0.0.0 LAN opt-in working.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} True when a 403 was sent.
 */
export function admitSameSite(req, res) {
  const hostedOrigin = authenticatedHostedRequests.get(req);
  const verdict = admitSameSiteRequest({
    hostHeader: hostedOrigin ? new URL(hostedOrigin).host : req.headers?.host,
    protocol: hostedOrigin
      ? 'https:'
      : req.socket?.encrypted
        ? 'https:'
        : 'http:',
    origin: req.headers?.origin,
    secFetchSite: req.headers?.['sec-fetch-site'],
    proxyHeaders: hostedOrigin ? {} : req.headers || {},
  });
  if (verdict.ok) return false;
  res.statusCode = verdict.status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: verdict.error }));
  return true;
}

/**
 * Wrap a middleware handler so cross-site requests are refused with 403
 * before the handler runs. Loopback tools and same-origin browser requests
 * pass straight through.
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: Function) => unknown} handler
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: Function) => unknown}
 */
export function sameSiteGated(handler) {
  return (req, res, next) => {
    if (admitSameSite(req, res)) return undefined;
    return handler(req, res, next);
  };
}
