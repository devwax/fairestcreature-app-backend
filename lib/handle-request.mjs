import querystring from 'node:querystring';
import {
  credentialsConfigured,
  getConfig,
  getConfigForShop,
  getDefaultConfig,
  listShopConfigs,
  runWithShopConfig,
  secretFingerprint,
} from './config.mjs';
import { routeRequest } from './handlers.mjs';
import { getAccessToken } from './shopify-admin.mjs';
import {
  collectProxyQuery,
  proxyAuthDiagnostics,
  verifyAppProxySignature,
} from './verify-proxy.mjs';

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

function safeShopSummary(config) {
  return {
    label: config.label,
    shop: config.shop,
    credentialsConfigured: credentialsConfigured(config),
    proxySecret: {
      configured: Boolean(config.apiSecret),
      length: config.apiSecret ? config.apiSecret.length : 0,
      source: config.apiSecretSource,
      fingerprint: secretFingerprint(config.apiSecret),
    },
  };
}

/**
 * Shared HTTP handler for local Node server and Vercel serverless.
 *
 * @param {import('http').IncomingMessage | import('http').IncomingMessage & { query?: object, body?: object }} req
 * @param {import('http').ServerResponse} res
 * @param {{ rawBody?: string, pathname?: string, query?: Record<string, string> }} [extras]
 */
export async function handleRequest(req, res, extras = {}) {
  const runtime = getDefaultConfig();
  const origin = req.headers.origin || '';

  const setCors = () => {
    if (origin && runtime.corsOrigins.includes(origin)) {
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
  // Only Shopify-signed query params — never merge Vercel catch-all `path` into HMAC.
  const query = extras.query || collectProxyQuery(req.url || '', req.query);

  const shopFromProxy = String(query.shop || '');
  const shopConfig = getConfigForShop(shopFromProxy) || getDefaultConfig();

  if (req.method === 'GET' && pathname === '/health') {
    const shops = [];
    for (const cfg of listShopConfigs()) {
      const summary = safeShopSummary(cfg);
      if (credentialsConfigured(cfg)) {
        try {
          await runWithShopConfig(cfg, () => getAccessToken());
          summary.tokenOk = true;
          summary.tokenError = null;
        } catch (e) {
          summary.tokenOk = false;
          summary.tokenError = String(e.message || e);
        }
      } else {
        summary.tokenOk = false;
        summary.tokenError = null;
      }
      shops.push(summary);
    }
    const config = getDefaultConfig();
    sendJson(200, {
      ok: true,
      shop: config.shop,
      credentialsConfigured: credentialsConfigured(config),
      tokenOk: shops[0]?.tokenOk ?? false,
      tokenError: shops[0]?.tokenError ?? null,
      requireAppProxy: config.requireAppProxy,
      proxySecret: shops[0]?.proxySecret,
      shops,
    });
    return;
  }

  return runWithShopConfig(shopConfig, async () => {
    const config = getConfig();

    if (config.requireAppProxy) {
      if (!getConfigForShop(shopFromProxy)) {
        sendJson(401, { status: false, data: 'Unknown shop' });
        return;
      }
      const ok = verifyAppProxySignature(query, config.apiSecret);
      if (!ok) {
        const diag = proxyAuthDiagnostics(query, config.apiSecret);
        console.error('[app-proxy] signature failed', { shop: config.shop, ...diag });
        const payload = { status: false, data: 'Invalid app proxy signature' };
        if (config.debugAppProxy) payload.debug = diag;
        sendJson(401, payload);
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
  });
}
