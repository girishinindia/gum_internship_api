import { pino } from 'pino';
import { env, isProd, isTest } from '../config/env';

/** App-wide structured logger. Request logging is wired in app.ts via pino-http. */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'internship-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
  },
  transport: !isProd && !isTest ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
