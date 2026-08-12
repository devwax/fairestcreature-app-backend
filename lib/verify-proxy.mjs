import crypto from 'node:crypto';

/**
 * Verify Shopify App Proxy signature query param.
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

  const pairs = [];
  for (const [key, raw] of Object.entries(query)) {
    if (key === 'signature') continue;
    const value = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join('');

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
 * Parse query string from a URL or raw search string into a plain object.
 * @param {string} urlOrSearch
 */
export function parseQueryFromUrl(urlOrSearch) {
  const search = urlOrSearch.includes('?') ? urlOrSearch.slice(urlOrSearch.indexOf('?')) : urlOrSearch;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of params.entries()) {
    if (key in out) {
      out[key] = `${out[key]},${value}`;
    } else {
      out[key] = value;
    }
  }
  return out;
}
