import { classifierConsumer } from './consumer.js';
import { disconnectKafka } from './kafka.js';
import { closePool } from '@andx/db';

async function main() {
  console.log('[Classifier] Starting AI Content Classifier worker process...');

  try {
    await classifierConsumer.start();
    console.log('[Classifier] Kafka consumer running.');
  } catch (err) {
    console.error('[Classifier] Failed to start Kafka consumer:', err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.log(`[Classifier] Received ${signal}, shutting down gracefully...`);
    await classifierConsumer.stop();

    try {
      await disconnectKafka();
      await closePool();
      console.log('[Classifier] Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[Classifier] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Classifier] Fatal startup error:', err);
  process.exit(1);
});
