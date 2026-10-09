import { buildServer } from './server.js';
import { config } from './config.js';
import { getProducer, disconnectKafka } from './kafka.js';
import { startLagMonitor, stopLagMonitor } from './backpressure.js';

async function main() {
  console.log('[Gateway] Starting up...');

  // 1. Initialize Kafka producer
  try {
    await getProducer();
    console.log('[Gateway] Kafka producer connected successfully.');
  } catch (err) {
    console.error('[Gateway] Failed to connect Kafka producer on startup:', err);
    // Continue running, producer will attempt reconnect on send
  }

  // 2. Start lag monitor for backpressure
  startLagMonitor();
  console.log('[Gateway] Lag monitor started.');

  // 3. Start Fastify server
  const server = buildServer();

  try {
    const address = await server.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`[Gateway] Server listening at ${address}`);
  } catch (err) {
    console.error('[Gateway] Failed to listen on port:', err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Gateway] Received ${signal}, shutting down gracefully...`);
    stopLagMonitor();
    try {
      await server.close();
      await disconnectKafka();
      console.log('[Gateway] Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[Gateway] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Gateway] Fatal startup error:', err);
  process.exit(1);
});
