import querystring from 'node:querystring';
import { credentialsConfigured, getConfig } from './config.mjs';
import { routeRequest } from './handlers.mjs';
import { getAccessToken } from './shopify-admin.mjs';
import { parseQueryFromUrl, verifyAppProxySignature } from './verify-proxy.mjs';

/**
 * Normalize path from App Proxy or direct hit.
 * Vercel catch-all may pass /api/customer.php — strip /api prefix.
 * @param {string} pathname
 */
export function normalizePath(pathname) {
  let path = pathname || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.startsWith('/api/')) path = path.slice(4);
  if (path === '/api') path = '/';
  return path;
}

/**
 * Shared HTTP handler for local Node server and Vercel serverless.
 *
 * @param {import('http').IncomingMessage | import('http').IncomingMessage & { query?: object, body?: object }} req
 * @param {import('http').ServerResponse} res
 * @param {{ rawBody?: string, pathname?: string, query?: Record<string, string> }} [extras]
 */
export async function handleRequest(req, res, extras = {}) {
  const config = getConfig();
  const origin = req.headers.origin || '';

  const setCors = () => {
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader(
      'Access-Control-Allow-Headers',
      'source-url, Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With'
    );
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  };

  const sendJson = (statusCode, payload) => {
    setCors();
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };

  if (req.method === 'OPTIONS') {
    sendJson(204, {});
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = normalizePath(extras.pathname || url.pathname);
  const query = extras.query || parseQueryFromUrl(url.search || '') || {};

  // Merge Vercel/query object if present
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (k === 'path') continue; // catch-all param
      query[k] = Array.isArray(v) ? v.join(',') : String(v);
    }
  }

  if (req.method === 'GET' && pathname === '/health') {
    let tokenOk = false;
    let tokenError = null;
    if (credentialsConfigured(config)) {
      try {
        await getAccessToken();
        tokenOk = true;
      } catch (e) {
        tokenError = String(e.message || e);
      }
    }
    sendJson(200, {
      ok: true,
      shop: config.shop,
      credentialsConfigured: credentialsConfigured(config),
      tokenOk,
      tokenError,
      requireAppProxy: config.requireAppProxy,
    });
    return;
  }

  if (config.requireAppProxy) {
    const ok = verifyAppProxySignature(query, config.apiSecret);
    if (!ok) {
      sendJson(401, { status: false, data: 'Invalid app proxy signature' });
      return;
    }
  }

  if (req.method !== 'POST') {
    sendJson(405, { status: false, data: 'Method not allowed' });
    return;
  }

  if (!credentialsConfigured(config)) {
    sendJson(500, {
      status: false,
      data: 'Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET',
    });
    return;
  }

  /** @type {Record<string, string>} */
  let data = {};
  if (extras.rawBody != null) {
    data = querystring.parse(extras.rawBody);
  } else if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    data = Object.fromEntries(
      Object.entries(req.body).map(([k, v]) => [k, v == null ? '' : String(v)])
    );
  } else if (typeof req.body === 'string') {
    data = querystring.parse(req.body);
  } else {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    data = querystring.parse(Buffer.concat(chunks).toString('utf8'));
  }

  try {
    const result = await routeRequest(pathname, data);
    const statusCode = result.statusCode || 200;
    const { statusCode: _sc, ...payload } = result;
    sendJson(statusCode, payload);
  } catch (err) {
    console.error(err);
    sendJson(500, { status: false, data: String(err.message || err) });
  }
}
