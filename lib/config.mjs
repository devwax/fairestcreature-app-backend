import crypto from 'node:crypto';

function trimEnv(value) {
  return String(value || '').trim();
}

export function getConfig() {
  const clientSecret = trimEnv(process.env.SHOPIFY_CLIENT_SECRET);
  const apiSecretExplicit = trimEnv(process.env.SHOPIFY_API_SECRET);
  const apiSecret = apiSecretExplicit || clientSecret;

  return {
    shop: trimEnv(process.env.SHOPIFY_SHOP) || 'fairestcreature-staging-gt0n4x79',
    clientId: trimEnv(process.env.SHOPIFY_CLIENT_ID),
    clientSecret,
    /** Shared secret for App Proxy HMAC (usually same as client secret on Dev Dashboard apps). */
    apiSecret,
    apiSecretSource: apiSecretExplicit
      ? 'SHOPIFY_API_SECRET'
      : clientSecret
        ? 'SHOPIFY_CLIENT_SECRET'
        : 'none',
    apiVersion: trimEnv(process.env.SHOPIFY_API_VERSION) || '2026-07',
    port: Number(process.env.PORT || 8787),
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    /**
     * When true, reject requests that fail App Proxy signature verification.
     * Set true on Vercel. Leave false for local direct testing (127.0.0.1).
     */
    requireAppProxy: String(process.env.REQUIRE_APP_PROXY || '').toLowerCase() === 'true',
    /** Include safe proxy-auth diagnostics in 401 JSON (staging only). */
    debugAppProxy: String(process.env.DEBUG_APP_PROXY || '').toLowerCase() === 'true',
  };
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
