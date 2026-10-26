import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config.js';

const WINDOW_MS = 15 * 60 * 1000;
const fromEnv = (name, fallback) => Number(process.env[name]) || fallback;

// Who is asking: the signed-in person when their token is valid, otherwise their internet address.
// Counting people rather than addresses means a school, office or mobile carrier sharing one address
// is not locked out together, while one person (or one address of strangers) still cannot flood the API.
export const callerKey = (req) => {
  if (req.rateLimitKey) return req.rateLimitKey;
  let key = `ip:${req.ip}`;
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (token) {
    try {
      const { userId } = jwt.verify(token, getJwtSecret());
      if (userId) key = `user:${userId}`;
    } catch { /* not a valid token: treat as an anonymous caller */ }
  }
  req.rateLimitKey = key;
  return key;
};

// Everything under /api. Signed-in people get a generous allowance of their own; anonymous traffic is limited per address.
export const createApiLimiter = ({ userMax = fromEnv('USER_RATE_LIMIT_MAX', 1500), anonymousMax = fromEnv('API_RATE_LIMIT_MAX', 600) } = {}) =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit: (req) => (callerKey(req).startsWith('user:') ? userMax : anonymousMax),
    keyGenerator: callerKey,
    message: { message: 'Too many requests. Please slow down for a moment.' },
  });

// Sign-up and login: a ceiling per address, high enough for a classroom signing up together
export const createAuthIpLimiter = ({ max = fromEnv('AUTH_RATE_LIMIT_MAX', 300) } = {}) =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit: max,
    message: { message: 'Too many sign-in attempts from this address. Please try again later.' },
  });

// Wrong passwords for one account from one address. Successful logins do not count.
// Mount this after the body is parsed, because the key includes the email.
export const createLoginAccountLimiter = ({ max = fromEnv('LOGIN_FAILURE_LIMIT', 20) } = {}) =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit: max,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
    message: { message: 'Too many failed attempts for this account. Please wait a few minutes or reset your password.' },
  });
