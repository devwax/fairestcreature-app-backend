import crypto from 'node:crypto';

/** Vercel / framework keys that must never enter the HMAC message. */
const IGNORED_QUERY_KEYS = new Set(['path', 'index']);

/**
 * Verify Shopify App Proxy signature query param.
 * Matches @shopify/shopify-api `signator: 'appProxy'` (sorted keys, no `&` join).
 * @see https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
 *
 * @param {Record<string, string | string[] | undefined>} query
 * @param {string} sharedSecret
 * @returns {boolean}
 */
export function verifyAppProxySignature(query, sharedSecret) {
  if (!sharedSecret || !query || typeof query !== 'object') return false;

  const signature = String(query.signature || '');
  if (!signature) return false;

  const message = buildAppProxyMessage(query);
  const digest = crypto.createHmac('sha256', sharedSecret).update(message).digest('hex');

  try {
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Build the App Proxy HMAC message (no separators between pairs).
 * @param {Record<string, string | string[] | undefined>} query
 */
export function buildAppProxyMessage(query) {
  return Object.entries(query)
    .filter(([key]) => key !== 'signature' && key !== 'hmac' && !IGNORED_QUERY_KEYS.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((acc, [key, raw]) => {
      const value = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
      return `${acc}${key}=${value}`;
    }, '');
}

/**
 * Parse query string from a URL or raw search string into a plain object.
 * Duplicate keys are joined with commas (Shopify App Proxy convention).
 * @param {string} urlOrSearch
 */
export function parseQueryFromUrl(urlOrSearch) {
  const search = urlOrSearch.includes('?')
    ? urlOrSearch.slice(urlOrSearch.indexOf('?'))
    : urlOrSearch;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of params.entries()) {
    if (IGNORED_QUERY_KEYS.has(key)) continue;
    if (key in out) {
      out[key] = `${out[key]},${value}`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Collect Shopify-signed query params from the request URL only.
 * Prefer raw `req.url` search string so Vercel catch-all `path` never pollutes HMAC.
 *
 * @param {string} reqUrl
 * @param {Record<string, unknown> | undefined} [vercelQuery]
 */
export function collectProxyQuery(reqUrl, vercelQuery) {
  const url = new URL(reqUrl || '/', 'http://localhost');
  const fromUrl = parseQueryFromUrl(url.search || '');
  if (Object.keys(fromUrl).length > 0) return fromUrl;

  // Fallback when the runtime exposes query only via req.query
  if (!vercelQuery || typeof vercelQuery !== 'object') return {};

  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(vercelQuery)) {
    if (IGNORED_QUERY_KEYS.has(k)) continue;
    out[k] = Array.isArray(v) ? v.map(String).join(',') : String(v ?? '');
  }
  return out;
}

/**
 * Safe diagnostics for failed proxy auth (no secret material).
 * @param {Record<string, string | string[] | undefined>} query
 * @param {string} sharedSecret
 */
export function proxyAuthDiagnostics(query, sharedSecret) {
  const keys = Object.keys(query || {}).sort();
  const signature = String(query?.signature || '');
  const message = buildAppProxyMessage(query || {});
  const digest = sharedSecret
    ? crypto.createHmac('sha256', sharedSecret).update(message).digest('hex')
    : '';

  return {
    hasSignature: Boolean(signature),
    queryKeys: keys,
    messageLength: message.length,
    messagePreview: message.slice(0, 160),
    secretConfigured: Boolean(sharedSecret),
    secretLength: sharedSecret ? sharedSecret.length : 0,
    digestPrefix: digest ? digest.slice(0, 12) : null,
    signaturePrefix: signature ? signature.slice(0, 12) : null,
  };
}
