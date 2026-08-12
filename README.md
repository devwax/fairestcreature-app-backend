# Fairest Creature — staging allocation bridge

Thin **Node** service that creates/completes Shopify customers for the Request Allocation form. No database, no React, no Prisma.

- **Local:** `npm start` → `http://127.0.0.1:8787`
- **Production (staging store):** Vercel + Shopify **App Proxy** → theme posts to `/apps/fc-bridge/customer.php`

Uses [client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant) against the Dev Dashboard app installed on the staging shop.

## Endpoints

| Path | Role |
|---|---|
| `GET /health` | Config + token smoke check |
| `POST /customer.php` | Create or complete allocation applicant |
| `POST /customer-account.php` | Name/phone update (legacy) |
| `POST /customer-update.php` | Address update (legacy) |

Response shape matches the old PHP bridge: `{ "status": true|false, "data": ... }`.

## Local

```bash
cp .env.example .env
# fill SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET
npm start
curl http://127.0.0.1:8787/health
```

Leave `REQUIRE_APP_PROXY=false` locally so the theme can hit `127.0.0.1` without a proxy signature.

## Deploy to Vercel (separate GitHub repo)

This folder is meant to be its **own** GitHub repository (not the theme monorepo).

1. Create an empty GitHub repo (e.g. `fairestcreature-staging-bridge-api`).
2. From this directory:

```bash
cd staging-bridge
git init
git add .
git commit -m "Initial staging allocation bridge for Vercel + App Proxy"
git branch -M main
git remote add origin git@github.com:<org>/<repo>.git
git push -u origin main
```

3. In Vercel: **Add New Project** → import that repo → root directory `.`
4. Set environment variables:

| Name | Value |
|---|---|
| `SHOPIFY_SHOP` | `fairestcreature-staging-gt0n4x79` |
| `SHOPIFY_CLIENT_ID` | from Dev Dashboard app |
| `SHOPIFY_CLIENT_SECRET` | from Dev Dashboard app |
| `SHOPIFY_API_SECRET` | same as client secret (App Proxy HMAC) |
| `REQUIRE_APP_PROXY` | `true` |
| `SHOPIFY_API_VERSION` | `2024-10` |
| `CORS_ORIGINS` | (optional when using App Proxy) |

5. Deploy → copy the production URL, e.g. `https://fairestcreature-staging-bridge.vercel.app`

## Shopify App Proxy

Configured on the Partner / Dev Dashboard app (`fairestcreature-staging-bridge` in the monorepo’s `fairestcreature-staging-bridge/shopify.app.toml`):

```toml
[app_proxy]
url = "https://YOUR-VERCEL-URL.vercel.app"
subpath = "fc-bridge"
prefix = "apps"
```

Then `shopify app deploy` (from the Shopify app project) so the proxy is live.

Storefront calls become same-origin:

`https://fairestcreature-staging-gt0n4x79.myshopify.com/apps/fc-bridge/customer.php`

→ Shopify verifies/forwards → `https://YOUR-VERCEL-URL.vercel.app/customer.php`

Theme base URL (staging): `/apps/fc-bridge` via `theme/snippets/fc-shopify-app-base.liquid`.

## App requirements

1. App installed on `fairestcreature-staging-gt0n4x79`
2. Scopes include `write_customers`, `read_customers`
3. App + shop in the same org (client credentials)

## `php/` folder

Legacy PHP copies for reference / optional shared-hosting deploy. **Not used** when running Node (local or Vercel).
