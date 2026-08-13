import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const shopConfigStore = new AsyncLocalStorage();

function trimEnv(value) {
  return String(value || '').trim();
}

function shopFromEnv(shop) {
  return trimEnv(shop).replace(/\.myshopify\.com$/i, '').toLowerCase();
}

function shopFromQueryValue(shop) {
  return shopFromEnv(shop);
}

function credentialsFromEnv({
  shop,
  clientId,
  clientSecret,
  apiSecretExplicit,
  accessToken,
  label,
}) {
  const secret = trimEnv(clientSecret);
  const apiSecret = trimEnv(apiSecretExplicit) || secret;
  return {
    label,
    shop: shopFromEnv(shop),
    clientId: trimEnv(clientId),
    clientSecret: secret,
    apiSecret,
    apiSecretSource: trimEnv(apiSecretExplicit)
      ? 'explicit'
      : secret
        ? 'client_secret'
        : 'none',
    accessToken: trimEnv(accessToken),
  };
}

function sharedRuntime() {
  return {
    apiVersion: trimEnv(process.env.SHOPIFY_API_VERSION) || '2026-07',
    port: Number(process.env.PORT || 8787),
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    requireAppProxy: String(process.env.REQUIRE_APP_PROXY || '').toLowerCase() === 'true',
    debugAppProxy: String(process.env.DEBUG_APP_PROXY || '').toLowerCase() === 'true',
  };
}

function mergeShop(creds) {
  return { ...sharedRuntime(), ...creds };
}

/** Staging uses the original unprefixed env vars so existing Vercel config keeps working. */
function stagingCreds() {
  return credentialsFromEnv({
    shop: process.env.SHOPIFY_SHOP || 'fairestcreature-staging-gt0n4x79',
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    apiSecretExplicit: process.env.SHOPIFY_API_SECRET,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    label: 'staging',
  });
}

function productionCreds() {
  const shop = process.env.SHOPIFY_PRODUCTION_SHOP || '54208e-eb';
  const clientId = process.env.SHOPIFY_PRODUCTION_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_PRODUCTION_CLIENT_SECRET;
  if (!trimEnv(clientId) && !trimEnv(clientSecret)) return null;
  return credentialsFromEnv({
    shop,
    clientId,
    clientSecret,
    apiSecretExplicit: process.env.SHOPIFY_PRODUCTION_API_SECRET,
    accessToken: process.env.SHOPIFY_PRODUCTION_ACCESS_TOKEN,
    label: 'production',
  });
}

/** All shops that have credentials configured (staging always listed). */
export function listShopConfigs() {
  const shops = [mergeShop(stagingCreds())];
  const production = productionCreds();
  if (production) shops.push(mergeShop(production));
  return shops;
}

/**
 * Resolve shop config from an App Proxy `shop` query value
 * (`54208e-eb.myshopify.com` or subdomain).
 * Unknown shop → null.
 */
export function getConfigForShop(shopQueryValue) {
  const key = shopFromQueryValue(shopQueryValue);
  if (!key) return null;
  return listShopConfigs().find((c) => c.shop === key) || null;
}

export function getDefaultConfig() {
  return mergeShop(stagingCreds());
}

/** Request-scoped shop config (set in handleRequest). Falls back to staging. */
export function getConfig() {
  return shopConfigStore.getStore() || getDefaultConfig();
}

export function runWithShopConfig(config, fn) {
  return shopConfigStore.run(config, fn);
}

export function credentialsConfigured(config = getConfig()) {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      !config.clientSecret.includes('xxx')
  );
}

/** Fingerprint secret without exposing it (compare local vs Vercel). */
export function secretFingerprint(secret) {
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12);
}
