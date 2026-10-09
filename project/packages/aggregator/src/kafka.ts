import { Kafka, Consumer, Producer, logLevel } from 'kafkajs';
import { config } from './config.js';

let kafkaInstance: Kafka | null = null;
let consumerInstance: Consumer | null = null;
let producerInstance: Producer | null = null;

export function getKafka(): Kafka {
  if (!kafkaInstance) {
    kafkaInstance = new Kafka({
      clientId: 'aggregator-service',
      brokers: config.kafkaBrokers,
      logLevel: logLevel.ERROR,
      retry: {
        initialRetryTime: 300,
        retries: 10,
      },
    });
  }
  return kafkaInstance;
}

export async function getConsumer(): Promise<Consumer> {
  if (!consumerInstance) {
    const kafka = getKafka();
    consumerInstance = kafka.consumer({
      groupId: config.consumerGroup,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 5 * 1024 * 1024,
    });
    await consumerInstance.connect();
  }
  return consumerInstance;
}

export async function getProducer(): Promise<Producer> {
  if (!producerInstance) {
    const kafka = getKafka();
    producerInstance = kafka.producer({
      idempotent: true,
      maxInFlightRequests: 5,
    });
    await producerInstance.connect();
  }
  return producerInstance;
}

export async function disconnectKafka(): Promise<void> {
  if (consumerInstance) {
    try {
      await consumerInstance.disconnect();
    } catch (err) {
      console.error('[Aggregator] Error disconnecting consumer:', err);
    }
    consumerInstance = null;
  }
  if (producerInstance) {
    try {
      await producerInstance.disconnect();
    } catch (err) {
      console.error('[Aggregator] Error disconnecting producer:', err);
    }
    producerInstance = null;
  }
}
