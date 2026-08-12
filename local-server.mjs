/**
 * Local Node server for staging Request Allocation bridge.
 * Same handlers as the Vercel api/ routes.
 *
 *   cp .env.example .env
 *   npm start
 *   curl http://127.0.0.1:8787/health
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, credentialsConfigured } from './lib/config.mjs';
import { handleRequest } from './lib/handle-request.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();

const config = getConfig();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: false, data: String(err.message || err) }));
  });
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Staging bridge listening on http://127.0.0.1:${config.port}`);
  console.log(`Shop: ${config.shop}`);
  console.log(
    `Credentials: ${
      credentialsConfigured(config)
        ? 'client_id + secret set (will exchange for 24h token)'
        : 'MISSING — set SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET'
    }`
  );
  console.log(`REQUIRE_APP_PROXY: ${config.requireAppProxy}`);
  console.log(`CORS: ${config.corsOrigins.join(', ') || '(none)'}`);
});
