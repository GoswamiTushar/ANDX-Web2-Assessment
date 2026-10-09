import { Kafka, Producer, logLevel } from 'kafkajs';
import { config } from './config.js';

let kafkaInstance: Kafka | null = null;
let producerInstance: Producer | null = null;

export function getKafka(): Kafka {
  if (!kafkaInstance) {
    kafkaInstance = new Kafka({
      clientId: 'api-service',
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

export async function getProducer(): Promise<Producer> {
  if (!producerInstance) {
    const kafka = getKafka();
    producerInstance = kafka.producer({
      allowAutoTopicCreation: false,
      idempotent: true,
      maxInFlightRequests: 1,
    });
    await producerInstance.connect();
  }
  return producerInstance;
}

export async function disconnectKafka(): Promise<void> {
  if (producerInstance) {
    try {
      await producerInstance.disconnect();
    } catch (err) {
      console.error('[API] Error disconnecting producer:', err);
    }
    producerInstance = null;
  }
}
