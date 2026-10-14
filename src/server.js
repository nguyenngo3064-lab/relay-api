// src/server.js
// Application entry point. Loads config, builds the app, and listens.

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './observability/logger.js';

async function main() {
  const config = loadConfig();

  if (config.problems.length) {
    // Fail fast. Print guidance without echoing secret values.
    process.stderr.write('HUAN RELAY cannot start: configuration is invalid.\n');
    for (const p of config.problems) process.stderr.write('  - ' + p + '\n');
    process.stderr.write(
      '\nCopy .env.example to .env and set the required values. Examples:\n' +
        `  SESSION_SECRET=$(generate)\n` +
        `  RELAY_ENCRYPTION_KEY=$(generate)\n`
    );
    process.stderr.write('Generate a secret with:\n  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
    process.exit(1);
  }

  const logger = createLogger({ level: config.isProd ? 'info' : 'debug' });
  const app = await buildApp({ config, logger });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 10000);
    if (force.unref) force.unref();
    try {
      await app.close();
      try {
        const db = app._internal && app._internal.db;
        if (db) {
          try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
          try { db.close(); } catch {}
        }
      } catch {}
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => { logger.error('unhandled rejection', { message: String(err && err.message || err) }); });
  process.on('uncaughtException', (err) => { logger.error('uncaught exception', { message: String(err && err.message || err) }); shutdown('EXCEPTION'); });

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info('HUAN RELAY listening', {
      url: `http://${config.host}:${config.port}`,
      env: config.nodeEnv,
    });
    if (!config.isProd) {
      logger.info('First-run: open the dashboard to create the administrator password.', {
        url: `http://${config.host}:${config.port}`,
      });
    }
  } catch (err) {
    logger.error('failed to start server', { error: err });
    process.exit(1);
  }
}

main();
