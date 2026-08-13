import { credentialsConfigured, getConfig } from './config.mjs';

/** @type {Map<string, { token: string, expiresAt: number }>} */
const cachedAuthByShop = new Map();

export async function getAccessToken() {
  const config = getConfig();
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
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    const msg = data.error_description || data.error || JSON.stringify(data) || `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${msg}`);
  }

  const expiresIn = Number(data.expires_in || 86399);
  cachedAuthByShop.set(config.shop, {
    token: data.access_token,
    expiresAt: now + expiresIn * 1000,
  });
  return data.access_token;
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
