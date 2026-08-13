# fairestcreature-app-backend

Thin **Node** service that creates/completes Shopify customers for the Request Allocation form. No database, no React, no Prisma.

| | |
|---|---|
| **GitHub** | https://github.com/devwax/fairestcreature-app-backend |
| **Vercel project** | https://vercel.com/kurtz8763-4260s-projects/fairestcreature-app-backend |
| **Production URL** | https://fairestcreature-app-backend.vercel.app |
| **Health** | https://fairestcreature-app-backend.vercel.app/health |

- **Local:** `npm start` → `http://127.0.0.1:8787`
- **Staging storefront:** App Proxy → theme posts to `/apps/fc-bridge/customer.php`

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

## Deploy to Vercel

1. This repo is the Vercel project root (linked above).
2. Environment variables (Production + Preview):

| Name | Value |
|---|---|
| `SHOPIFY_SHOP` | `fairestcreature-staging-gt0n4x79` |
| `SHOPIFY_CLIENT_ID` | staging Dev Dashboard app |
| `SHOPIFY_CLIENT_SECRET` | staging Dev Dashboard app |
| `SHOPIFY_API_SECRET` | same as staging client secret (App Proxy HMAC) |
| `SHOPIFY_PRODUCTION_SHOP` | `54208e-eb` |
| `SHOPIFY_PRODUCTION_CLIENT_ID` | production app (Fairest Creature Customer Accounts) |
| `SHOPIFY_PRODUCTION_CLIENT_SECRET` | production app |
| `SHOPIFY_PRODUCTION_API_SECRET` | same as production client secret |
| `REQUIRE_APP_PROXY` | `true` |
| `SHOPIFY_API_VERSION` | `2026-07` |
| `CORS_ORIGINS` | (optional when using App Proxy) |

Do **not** replace the staging `SHOPIFY_CLIENT_*` vars with production values — both shops share this URL. HMAC and Admin tokens are chosen from the App Proxy `shop` query.

## Shopify App Proxy

Configured in the FairestCreature monorepo:

- Staging: `fairestcreature-staging-bridge/shopify.app.toml`
- Production: `fairestcreature-staging-bridge/shopify.app.production.toml`

```toml
[app_proxy]
url = "https://fairestcreature-app-backend.vercel.app"
subpath = "fc-bridge"
prefix = "apps"
```

Deploy app config with `shopify app deploy` (staging) or `shopify app deploy --config production` so the proxy is live on that shop.

Storefront:

`https://fairestcreature-staging-gt0n4x79.myshopify.com/apps/fc-bridge/customer.php`

→ Shopify forwards → `https://fairestcreature-app-backend.vercel.app/customer.php`

Theme base URL (staging): `/apps/fc-bridge` via `theme/snippets/fc-shopify-app-base.liquid`.

## App requirements

1. App installed on the target shop (`fairestcreature-staging-gt0n4x79` and/or `54208e-eb`)
2. Scopes include `write_customers`, `read_customers`
3. App + shop in the same org (client credentials). Staging and production are **different orgs** — use two Partner apps, never install the staging app on production.

## `php/` folder

Legacy PHP copies for reference / optional shared-hosting deploy. **Not used** when running Node (local or Vercel).
