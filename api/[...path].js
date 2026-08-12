import { handleRequest } from '../lib/handle-request.mjs';

/**
 * Vercel serverless catch-all.
 * App Proxy URL should be https://<project>.vercel.app
 * so /apps/fc-bridge/customer.php → /customer.php → rewrite → /api/customer.php
 *
 * Note: for a file named `[...path].js`, Vercel exposes the segments as `req.query['...path']`.
 */
export default async function handler(req, res) {
  const pathParam = req.query?.['...path'] ?? req.query?.path;
  let pathname = '/';
  if (Array.isArray(pathParam)) {
    pathname = `/${pathParam.join('/')}`;
  } else if (typeof pathParam === 'string' && pathParam) {
    pathname = `/${pathParam}`;
  }

  await handleRequest(req, res, { pathname });
}
