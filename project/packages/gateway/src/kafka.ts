import { Kafka, Producer, Admin, CompressionTypes, logLevel } from 'kafkajs';
import { config } from './config.js';

let kafkaInstance: Kafka | null = null;
let producerInstance: Producer | null = null;
let adminInstance: Admin | null = null;

export function getKafka(): Kafka {
  if (!kafkaInstance) {
    kafkaInstance = new Kafka({
      clientId: 'gateway-service',
      brokers: config.kafkaBrokers,
      logLevel: logLevel.ERROR,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });
  }
  return kafkaInstance;
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

export async function getAdmin(): Promise<Admin> {
  if (!adminInstance) {
    const kafka = getKafka();
    adminInstance = kafka.admin();
    await adminInstance.connect();
  }
  return adminInstance;
}

export async function disconnectKafka(): Promise<void> {
  if (producerInstance) {
    try {
      await producerInstance.disconnect();
    } catch (err) {
      console.error('Error disconnecting producer:', err);
    }
    producerInstance = null;
  }
  if (adminInstance) {
    try {
      await adminInstance.disconnect();
    } catch (err) {
      console.error('Error disconnecting admin:', err);
    }
    adminInstance = null;
  }
}

export { CompressionTypes };
