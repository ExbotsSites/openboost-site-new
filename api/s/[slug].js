'use strict';

const {
  normalizeSlug,
  redisCommand,
  redisConfigured,
  sendJson
} = require('../../lib/shortener');

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('Short link not found.\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!redisConfigured()) {
    return sendJson(res, 503, { error: 'Short link storage is not configured.' });
  }

  const rawSlug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const slug = normalizeSlug(rawSlug);
  if (!slug) return notFound(res);

  let stored;
  try {
    stored = await redisCommand(['GET', `shortlink:${slug}`]);
  } catch (error) {
    console.error('Short link lookup failed:', error);
    return sendJson(res, 500, { error: 'Could not look up the short link.' });
  }

  if (!stored) return notFound(res);

  let link;
  try {
    link = typeof stored === 'string' ? JSON.parse(stored) : stored;
  } catch {
    return notFound(res);
  }

  if (!link || typeof link.url !== 'string') return notFound(res);

  try {
    const destination = new URL(link.url);
    if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return notFound(res);
  } catch {
    return notFound(res);
  }

  res.statusCode = 302;
  res.setHeader('Location', link.url);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end();
};
