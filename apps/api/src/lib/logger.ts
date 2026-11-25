import pino from 'pino';

/** Redacts anything that could carry a credential. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-goog-api-key"]',
      '*.apiKey', '*.encryptedKey', '*.token', '*.secret', 'apiKey', 'encryptedKey',
    ],
    censor: '[redacted]',
  },
});
