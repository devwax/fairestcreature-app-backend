export function getConfig() {
  return {
    shop: process.env.SHOPIFY_SHOP || 'fairestcreature-staging-gt0n4x79',
    clientId: process.env.SHOPIFY_CLIENT_ID || '',
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
    /** Shared secret for App Proxy HMAC (usually same as client secret on Dev Dashboard apps). */
    apiSecret: process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-10',
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
  };
}

export function credentialsConfigured(config = getConfig()) {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      !config.clientSecret.includes('xxx')
  );
}
