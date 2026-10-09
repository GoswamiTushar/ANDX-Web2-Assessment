import { loadEnv } from '@andx/contracts';

// Load .env
loadEnv();

/**
 * AI Content Classifier Worker Configuration
 */
export const config = {
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'broker:9092').split(','),
  topicClipText: process.env.TOPIC_INGEST_CLIP_TEXT || 'ingest.clip-text.v1',
  consumerGroup: process.env.CLASSIFIER_CONSUMER_GROUP || 'classifier-group',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://andx:andx_secret@postgres:5432/andx_db',

  // LLM settings
  llmBaseUrl: (process.env.LLM_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, ''),
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'grok-4.7',

  // Processing bounds
  concurrency: 5,
  requestTimeoutMs: 15000,
};
