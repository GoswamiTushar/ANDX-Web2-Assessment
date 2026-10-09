import { loadEnv } from '@andx/contracts';

// Load .env if present
loadEnv();

/**
 * Aggregator Worker Configuration loaded from .env
 */
export const config = {
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'broker:9092').split(','),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://andx:andx_secret@postgres:5432/andx_db',
  consumerGroup: process.env.AGGREGATOR_CONSUMER_GROUP || 'aggregator-group',

  // Performance batching bounds
  batchSize: parseInt(process.env.AGGREGATOR_BATCH_SIZE || '2000', 10),
  flushIntervalMs: parseInt(process.env.AGGREGATOR_FLUSH_INTERVAL_MS || '100', 10),

  // Kafka topics
  topics: {
    snapshots: process.env.TOPIC_INGEST_SNAPSHOTS || 'ingest.snapshots.v1',
    invalid: process.env.TOPIC_INGEST_INVALID || 'ingest.invalid.v1',
    commands: process.env.TOPIC_DLQ_COMMANDS || 'dlq.commands.v1',
    clipViews: process.env.TOPIC_AGGREGATOR_CLIP_VIEWS || 'aggregator.clip-views.v1',
  },

  // Outbox polling
  outboxPollIntervalMs: parseInt(process.env.OUTBOX_POLL_INTERVAL_MS || '20', 10),
  outboxBatchSize: parseInt(process.env.OUTBOX_BATCH_SIZE || '1000', 10),
};
