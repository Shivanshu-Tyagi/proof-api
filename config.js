import dotenv from 'dotenv';

dotenv.config();

const isProduction = () => process.env.NODE_ENV === 'production';

// Read lazily so tests (and tools) can set env vars after import
export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction()) throw new Error('JWT_SECRET must be set in production');
  return 'dev_only_insecure_secret';
};

// The owner(s) of the app: people allowed to reply to feedback and remove any of it. Set ADMIN_EMAILS to a comma-separated list.
export const isAdminEmail = (email) =>
  !!email && (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(String(email).toLowerCase());

export const getFrontendUrls = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, '')) // browsers send origins without a trailing slash
    .filter(Boolean);

// Fail fast at boot instead of at the first request
export const validateConfig = () => {
  if (!isProduction()) return;
  const missing = ['JWT_SECRET', 'MONGO_URI', 'FRONTEND_URL'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
};
