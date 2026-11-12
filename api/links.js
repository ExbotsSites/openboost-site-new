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
const LIMIT_PER_MINUTE = 5;
const LIMIT_PER_DAY = 50;

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

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function underLimit(key, max, windowSeconds) {
  const count = await redisCommand(['INCR', key]);
  if (count === 1) await redisCommand(['EXPIRE', key, String(windowSeconds)]);
  return count <= max;
}

async function turnstileOk(token, ip) {
  if (!process.env.TURNSTILE_SECRET) return true;
  if (!token || typeof token !== 'string') return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET,
        response: token,
        remoteip: ip
      })
    });
    const data = await r.json();
    return data.success === true;
  } catch {
    return false;
  }
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

  const ip = getIp(req);

  try {
    const okMinute = await underLimit(`rl:m:${ip}`, LIMIT_PER_MINUTE, 60);
    const okDay = await underLimit(`rl:d:${ip}`, LIMIT_PER_DAY, 86400);
    if (!okMinute || !okDay) {
      res.setHeader('Retry-After', '60');
      return sendJson(res, 429, { error: 'Too many links created. Try again later.' });
    }
  } catch (error) {
    console.error('Rate limit failed:', error);
    return sendJson(res, 500, { error: 'Could not check rate limit.' });
  }

  if (!(await turnstileOk(body.turnstileToken, ip))) {
    return sendJson(res, 400, { error: 'Captcha failed. Refresh and try again.' });
  }

  let destination;
  try {
    destination = validateDestination(body.url);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  if (!(await urlIsSafe(destination))) {
    return sendJson(res, 400, { error: 'This URL was flagged as unsafe.' });
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