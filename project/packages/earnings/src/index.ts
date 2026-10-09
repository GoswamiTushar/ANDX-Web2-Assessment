import { earningsConsumer } from './consumer.js';
import { dbWriter } from './dbWriter.js';
import { scheduler } from './scheduler.js';
import { disconnectKafka } from './kafka.js';
import { closePool } from '@andx/db';

async function main() {
  console.log('[Earnings] Starting earnings worker process...');

  // 1. Initial catch-up on registered campaigns
  try {
    const initializedCount = await dbWriter.catchUpAllCampaigns();
    console.log(`[Earnings] Initialized spend records for ${initializedCount} campaigns.`);
  } catch (err) {
    console.warn('[Earnings] Non-fatal error during initial catch-up:', err);
  }

  // 2. Start Kafka consumer for clip views updates
  try {
    await earningsConsumer.start();
    console.log('[Earnings] Kafka consumer running.');
  } catch (err) {
    console.error('[Earnings] Failed to start Kafka consumer:', err);
    process.exit(1);
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`[Earnings] Received ${signal}, shutting down gracefully...`);
    await earningsConsumer.stop();

    try {
      await scheduler.flushDirty();
      await disconnectKafka();
      await closePool();
      console.log('[Earnings] Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[Earnings] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Earnings] Fatal startup error:', err);
  process.exit(1);
});
