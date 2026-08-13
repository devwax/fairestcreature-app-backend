import crypto from 'node:crypto';
import { getConfigForShop } from './config.mjs';

const DEFAULT_REDIRECT =
  'https://fairestcreature-app-backend.vercel.app/oauth/callback';
const DEFAULT_SCOPES =
  'read_customers,write_customers,write_metaobject_definitions,write_metaobjects,write_products';
const STATE_TTL_MS = 15 * 60 * 1000;

function oauthRedirectUri() {
  return String(process.env.OAUTH_REDIRECT_URI || DEFAULT_REDIRECT).trim();
}

function oauthScopes() {
  return String(process.env.OAUTH_SCOPES || DEFAULT_SCOPES).trim();
}

function timingSafeHexEqual(a, b) {
  try {
    const left = Buffer.from(String(a), 'hex');
    const right = Buffer.from(String(b), 'hex');
    if (left.length === 0 || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function signState(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
}

export function buildSignedState(shop, secret) {
  const exp = Date.now() + STATE_TTL_MS;
  const payload = `${shop}.${exp}`;
  return `${payload}.${signState(payload, secret)}`;
}

export function verifySignedState(state, shop, secret) {
  const parts = String(state || '').split('.');
  if (parts.length !== 3 || !secret) return false;
  const [stateShop, expRaw, sig] = parts;
  if (stateShop !== shop) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = signState(`${stateShop}.${expRaw}`, secret);
  return timingSafeHexEqual(sig, expected);
}

/** Shopify OAuth callback HMAC (sorted `key=value` joined with `&`). */
export function verifyOAuthCallbackHmac(query, secret) {
  const hmac = String(query.hmac || '');
  if (!hmac || !secret) return false;
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => {
      const v = query[k];
      const val = Array.isArray(v) ? v.join(',') : String(v ?? '');
      return `${k}=${val}`;
    })
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return timingSafeHexEqual(digest, hmac);
}

export function authorizeUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: oauthScopes(),
    redirect_uri: oauthRedirectUri(),
    state,
  });
  return `https://${config.shop}.myshopify.com/admin/oauth/authorize?${params}`;
}

export async function exchangeAuthorizationCode(config, code) {
  const url = `https://${config.shop}.myshopify.com/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token) {
    const detail =
      data.error_description ||
      data.error ||
      (text && text.slice(0, 180)) ||
      '(empty body)';
    throw new Error(`Authorization code exchange failed: HTTP ${res.status} ${detail}`);
  }
  return data.access_token;
}

export function resolveOAuthShop(shopQuery) {
  return getConfigForShop(shopQuery);
}

export function oauthRedirectUriValue() {
  return oauthRedirectUri();
}
