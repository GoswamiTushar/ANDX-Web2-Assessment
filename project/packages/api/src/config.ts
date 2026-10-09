import { loadEnv } from '@andx/contracts';

// Load .env
loadEnv();

/**
 * Public Query & Admin API Configuration loaded from .env
 */
export const config = {
  port: parseInt(process.env.API_PORT || process.env.PORT || '8081', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://andx:andx_secret@postgres:5432/andx_db',
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'broker:9092').split(','),
  topicDlqCommands: process.env.TOPIC_DLQ_COMMANDS || 'dlq.commands.v1',
};
