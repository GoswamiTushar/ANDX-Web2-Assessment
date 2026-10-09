import { buildServer } from './server.js';
import { config } from './config.js';
import { disconnectKafka } from './kafka.js';
import { closePool } from '@andx/db';

async function main() {
  const server = buildServer();

  try {
    await server.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`[API] Public Query & Admin API running on http://${config.host}:${config.port}`);
  } catch (err) {
    console.error('[API] Failed to start HTTP server:', err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.log(`[API] Received ${signal}, closing server gracefully...`);
    try {
      await server.close();
      await disconnectKafka();
      await closePool();
      console.log('[API] Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[API] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[API] Fatal startup error:', err);
  process.exit(1);
});
