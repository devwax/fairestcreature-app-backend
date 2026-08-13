import { credentialsConfigured, getConfig } from './config.mjs';

/** @type {Map<string, { token: string, expiresAt: number }>} */
const cachedAuthByShop = new Map();

export function tokenSource(config = getConfig()) {
  if (config.accessToken) return 'offline';
  return 'client_credentials';
}

export async function getAccessToken() {
  const config = getConfig();
  if (config.accessToken) {
    return config.accessToken;
  }
  if (!credentialsConfigured(config)) {
    throw new Error('Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET');
  }

  const now = Date.now();
  const cachedAuth = cachedAuthByShop.get(config.shop);
  if (cachedAuth && cachedAuth.expiresAt > now + 60_000) {
    return cachedAuth.token;
  }

  const url = `https://${config.shop}.myshopify.com/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
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
    throw new Error(`Token exchange failed: HTTP ${res.status} ${detail}`);
  }

  const expiresIn = Number(data.expires_in || 86399);
  cachedAuthByShop.set(config.shop, {
    token: data.access_token,
    expiresAt: now + expiresIn * 1000,
  });
  return data.access_token;
}

/** Cheap Admin API check used by /health (proves an offline token actually works). */
export async function probeAdminAccess() {
  const config = getConfig();
  const token = await getAccessToken();
  const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/shop.json`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin probe failed: HTTP ${res.status} ${(text || '').slice(0, 180)}`);
  }
  return token;
}

export async function shopify(method, endpoint, body) {
  const config = getConfig();
  const token = await getAccessToken();
  const url = `https://${config.shop}.myshopify.com${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { errors: text || `HTTP ${res.status}` };
  }
}

export function getApiVersion() {
  return getConfig().apiVersion;
}
