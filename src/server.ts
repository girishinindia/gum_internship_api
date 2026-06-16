import { env } from './config/env'; // first import: crashes loudly if env is invalid
import { app } from './app';
import { logger } from './core/logger';
import { closePool } from './db/pool';

import { liveService } from './modules/live/service';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'internship-api listening');
});

// Live-session reminder sweep (T-24h / T-1h). Swap for a real scheduler with
// the queue upgrade; sweep is idempotent via sent-markers.
const reminderTimer = setInterval(() => {
  liveService.runDueReminders().catch((err) => logger.error({ err }, 'reminder sweep failed'));
}, 60_000);
reminderTimer.unref();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down…');
  server.close(async () => {
    try {
      await closePool();
      logger.info('Closed HTTP server and DB pool. Bye.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });
  // Hard-exit if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — exiting');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
