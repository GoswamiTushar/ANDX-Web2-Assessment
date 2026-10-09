import { campaignResolver } from './campaignResolver.js';
import { outboxRelay } from './outboxRelay.js';
import { aggregatorConsumer } from './consumer.js';
import { disconnectKafka } from './kafka.js';
import { closePool } from '@andx/db';

async function main() {
  console.log('[Aggregator] Starting worker process...');

  // 1. Preload campaign catalog from PostgreSQL
  try {
    await campaignResolver.init();
    console.log(
      `[Aggregator] Campaign resolver initialized with ${campaignResolver.getAll().size} active campaigns.`
    );
  } catch (err) {
    console.error('[Aggregator] Failed to initialize campaign resolver:', err);
    process.exit(1);
  }

  // 2. Start transactional outbox relay
  outboxRelay.start();
  console.log('[Aggregator] Outbox relay background worker started.');

  // 3. Start Kafka batch consumer
  try {
    await aggregatorConsumer.start();
    console.log('[Aggregator] Kafka consumer running.');
  } catch (err) {
    console.error('[Aggregator] Failed to start Kafka consumer:', err);
    process.exit(1);
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`[Aggregator] Received ${signal}, shutting down gracefully...`);
    outboxRelay.stop();
    await aggregatorConsumer.stop();

    try {
      await disconnectKafka();
      await closePool();
      console.log('[Aggregator] Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[Aggregator] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Aggregator] Fatal startup error:', err);
  process.exit(1);
});
