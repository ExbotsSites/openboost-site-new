'use strict';

const crypto = require('crypto');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  return { url: url.replace(/\/+$/, ''), token };
}

function redisConfigured() {
  const config = redisConfig();
  return Boolean(config.url && config.token);
}

async function redisCommand(command) {
  const { url, token } = redisConfig();
  if (!url || !token) throw new Error('Redis is not configured.');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    throw new Error('Redis returned an unreadable response.');
  }

  if (!response.ok || data.error) {
    throw new Error(data.error || `Redis request failed (${response.status}).`);
  }

  return data.result;
}

function normalizeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return null;
  return slug;
}

function randomSlug() {
  return crypto.randomBytes(4).toString('hex');
}

function validateDestination(value) {
  if (typeof value !== 'string') throw new Error('Destination must be a URL.');
  const raw = value.trim();
  if (!raw || raw.length > 2048) throw new Error('Destination must be between 1 and 2048 characters.');
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error('Destination contains invalid characters.');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Destination must be a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https links are allowed.');
  }
  if (!parsed.hostname) throw new Error('Destination must include a hostname.');
  if (parsed.username || parsed.password) throw new Error('URLs with embedded credentials are not allowed.');

  return parsed.toString();
}

function getOrigin(req) {
  if (process.env.SHORTENER_ORIGIN) return process.env.SHORTENER_ORIGIN.replace(/\/+$/, '');
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${protocol}://${host}` : '';
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = {
  getOrigin,
  normalizeSlug,
  randomSlug,
  redisCommand,
  redisConfigured,
  sendJson,
  validateDestination
};
