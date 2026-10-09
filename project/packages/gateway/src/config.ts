import { loadEnv } from '@andx/contracts';

// Load .env if present
loadEnv();

/**
 * Gateway Configuration loaded from .env
 */
export const config = {
  port: parseInt(process.env.GATEWAY_PORT || process.env.PORT || '8080', 10),
  host: process.env.GATEWAY_HOST || process.env.HOST || '0.0.0.0',
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'broker:9092').split(','),
  
  // Section 6.1 bounds
  maxBodySizeBytes: parseInt(process.env.GATEWAY_MAX_BODY_SIZE_BYTES || String(8 * 1024 * 1024), 10),
  maxLineCount: parseInt(process.env.GATEWAY_MAX_LINE_COUNT || '10000', 10),
  
  // Backpressure thresholds per Rule 5.2.8 & tuning
  lagThreshold429: parseInt(process.env.LAG_THRESHOLD_429 || '400000', 10),
  lagThreshold503: parseInt(process.env.LAG_THRESHOLD_503 || '1500000', 10),
  lagPollIntervalMs: parseInt(process.env.LAG_POLL_INTERVAL_MS || '1000', 10),
  
  // Kafka topics
  topics: {
    snapshots: process.env.TOPIC_INGEST_SNAPSHOTS || 'ingest.snapshots.v1',
    clipText: process.env.TOPIC_INGEST_CLIP_TEXT || 'ingest.clip-text.v1',
    invalid: process.env.TOPIC_INGEST_INVALID || 'ingest.invalid.v1',
  },
  
  // Consumer group to monitor for lag (strictly aggregator-group, NEVER earnings)
  targetConsumerGroup: process.env.LAG_TARGET_CONSUMER_GROUP || process.env.AGGREGATOR_CONSUMER_GROUP || 'aggregator-group',
};
