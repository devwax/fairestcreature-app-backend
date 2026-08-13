import { handleRequest } from '../lib/handle-request.mjs';

export default async function handler(req, res) {
  await handleRequest(req, res, { pathname: '/oauth/start' });
}
