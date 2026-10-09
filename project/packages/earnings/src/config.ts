import { loadEnv } from '@andx/contracts';

// Load .env if present
loadEnv();

/**
 * Earnings Service Configuration loaded from .env
 */
export const config = {
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'broker:9092').split(','),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://andx:andx_secret@postgres:5432/andx_db',
  consumerGroup: process.env.EARNINGS_CONSUMER_GROUP || 'earnings-group',
  topicClipViews: process.env.TOPIC_AGGREGATOR_CLIP_VIEWS || 'aggregator.clip-views.v1',

  // Performance and debouncing bounds
  debounceMs: parseInt(process.env.EARNINGS_DEBOUNCE_MS || '200', 10),
  batchSize: parseInt(process.env.EARNINGS_BATCH_SIZE || '1000', 10),
};
