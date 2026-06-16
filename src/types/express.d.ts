import type { AuthUser } from '../middlewares/auth';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. Absent on public routes. */
      user?: AuthUser;
      /** Set by pino-http (request id). */
      id?: string;
      /** Raw body captured for webhook signature verification (module 2.8). */
      rawBody?: Buffer;
    }
  }
}

export {};
