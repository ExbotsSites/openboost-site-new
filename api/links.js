'use strict';

const {
  getOrigin,
  randomSlug,
  redisCommand,
  redisConfigured,
  sendJson,
  validateDestination
} = require('../lib/shortener');

const MAX_RANDOM_ATTEMPTS = 5;

function parseBody(body) {
  if (!body) return {};
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return typeof body === 'object' ? body : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!redisConfigured()) {
    return sendJson(res, 503, { error: 'Redis is not configured. Add the Upstash environment variables in Vercel.' });
  }

  const body = parseBody(req.body);
  if (!body) return sendJson(res, 400, { error: 'Request body must be valid JSON.' });

  let destination;
  try {
    destination = validateDestination(body.url);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  const origin = getOrigin(req);
  if (!origin) return sendJson(res, 500, { error: 'Could not determine the site origin.' });

  const value = JSON.stringify({
    url: destination,
    createdAt: new Date().toISOString()
  });

  try {
    for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt += 1) {
      const slug = randomSlug();
      const result = await redisCommand(['SET', `shortlink:${slug}`, value, 'NX']);

      if (result === 'OK') {
        return sendJson(res, 201, {
          slug,
          url: destination,
          shortUrl: `${origin}/s/${slug}`
        });
      }
    }

    return sendJson(res, 409, { error: 'Could not generate a free random code. Try again.' });
  } catch (error) {
    console.error('Short link creation failed:', error);
    return sendJson(res, 500, { error: 'Could not save the short link. Check the Redis connection.' });
  }
};
