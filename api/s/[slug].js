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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function unsafePage(res, hostname) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link blocked</title>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;line-height:1.5">
<h1>Link blocked</h1>
<p>This short link pointed to <strong>${escapeHtml(hostname)}</strong>, which was flagged as unsafe, so the redirect was stopped.</p>
</body>`);
}

async function urlIsSafe(url) {
  if (!process.env.SAFE_BROWSING_KEY) return true;
  try {
    const r = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${process.env.SAFE_BROWSING_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'axy-short', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }]
          }
        })
      }
    );
    const data = await r.json();
    return !data.matches;
  } catch {
    return true;
  }
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

  let destination;
  try {
    destination = new URL(link.url);
    if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return notFound(res);
  } catch {
    return notFound(res);
  }

  try {
    if (await redisCommand(['EXISTS', `blocked:${slug}`])) {
      return unsafePage(res, destination.hostname);
    }

    const cached = await redisCommand(['GET', `safe:${slug}`]);
    if (!cached) {
      if (await urlIsSafe(link.url)) {
        await redisCommand(['SET', `safe:${slug}`, '1', 'EX', '21600']);
      } else {
        await redisCommand(['SET', `blocked:${slug}`, '1']);
        return unsafePage(res, destination.hostname);
      }
    }
  } catch (error) {
    console.error('Safety check failed:', error);
  }

  res.statusCode = 302;
  res.setHeader('Location', link.url);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end();
};