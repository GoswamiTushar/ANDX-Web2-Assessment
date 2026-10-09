import { Kafka, Consumer, logLevel } from 'kafkajs';
import { config } from './config.js';

let kafkaInstance: Kafka | null = null;
let consumerInstance: Consumer | null = null;

export function getKafka(): Kafka {
  if (!kafkaInstance) {
    kafkaInstance = new Kafka({
      clientId: 'earnings-service',
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

export async function disconnectKafka(): Promise<void> {
  if (consumerInstance) {
    try {
      await consumerInstance.disconnect();
    } catch (err) {
      console.error('[Earnings] Error disconnecting consumer:', err);
    }
    consumerInstance = null;
  }
}
