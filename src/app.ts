import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env } from './config/env';
import { logger } from './core/logger';
import { ApiResponse } from './core/apiResponse';
import { AppError } from './core/appError';
import { errorMiddleware, notFoundHandler } from './core/errorMiddleware';
import { generalLimiter } from './middlewares/rateLimiter';
import { apiRouter } from './routes/index';
import { registerNotificationSubscribers } from './modules/notifications/service';
import { registerGamificationSubscribers } from './modules/gamification/service';
import { registerCpdSubscribers } from './modules/cpd/service';

registerNotificationSubscribers();
registerGamificationSubscribers();
registerCpdSubscribers();

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a reverse proxy in staging/prod

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Allow no-origin requests (curl, server-to-server, mobile apps)
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError('FORBIDDEN', 'Origin not allowed by CORS'));
      },
      credentials: true,
    }),
  );

  // rawBody is captured for Razorpay/Bunny webhook HMAC verification (module 2.8)
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = typeof existing === 'string' && existing ? existing : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Liveness only — no DB dependency, so orchestrators can restart cleanly.
  app.get('/health', (_req, res) => {
    ApiResponse.ok(res, {
      status: 'ok',
      env: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Dev-only error probe for the acceptance checklist (proves AppError → envelope).
  if (env.NODE_ENV === 'development') {
    app.get('/__dev/error', () => {
      throw AppError.conflict('Demo conflict from /__dev/error');
    });
  }

  app.use('/v1', generalLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorMiddleware);

  return app;
}

export const app = createApp();
