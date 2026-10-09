import type { EachBatchPayload } from 'kafkajs';
import { getConsumer } from './kafka.js';
import { config } from './config.js';
import { classifierOrchestrator } from './classifier.js';
import { dbWriter, type EvaluatedClip } from './dbWriter.js';
import type { NormalizedClipText } from '@andx/contracts';

export class ClassifierConsumer {
  private isRunning = false;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const consumer = await getConsumer();

    await consumer.subscribe({
      topic: config.topicClipText,
      fromBeginning: true,
    });

    console.log(`[Classifier] Subscribed to topic: ${config.topicClipText}`);

    await consumer.run({
      autoCommit: true,
      autoCommitInterval: 1000,
      eachBatchAutoResolve: false,
      eachBatch: async (payload: EachBatchPayload) => {
        await this.handleBatch(payload);
      },
    });
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
  }

  private async handleBatch({
    batch,
    resolveOffset,
    heartbeat,
    commitOffsetsIfNecessary,
  }: EachBatchPayload): Promise<void> {
    const messages = batch.messages;
    if (messages.length === 0) return;

    console.log(`[Classifier] Received batch of ${messages.length} messages on partition ${batch.partition}`);

    const parsedEvents: NormalizedClipText[] = [];

    for (const msg of messages) {
      if (!msg.value) continue;
      try {
        const event: NormalizedClipText = JSON.parse(msg.value.toString('utf8'));
        if (event.clip_id && event.campaign_id) {
          parsedEvents.push(event);
        }
      } catch (err) {
        console.error('[Classifier] Corrupt clip_text message:', err);
      }
    }

    if (parsedEvents.length > 0) {
      const evaluations: EvaluatedClip[] = [];

      // Process in concurrent chunks of config.concurrency
      const concurrency = config.concurrency;
      for (let i = 0; i < parsedEvents.length; i += concurrency) {
        const chunk = parsedEvents.slice(i, i + concurrency);
        const results = await Promise.all(
          chunk.map(async (event) => {
            const result = await classifierOrchestrator.classify(
              event.campaign_id,
              event.caption,
              event.transcript
            );
            return {
              clip_id: event.clip_id,
              campaign_id: event.campaign_id,
              result,
            };
          })
        );

        evaluations.push(...results);
        await heartbeat();
      }

      // Bulk upsert into classifier.clip_relevance
      await dbWriter.saveEvaluations(evaluations);
      console.log(`[Classifier] Saved ${evaluations.length} clip relevance evaluations.`);
    }

    await heartbeat();

    // Commit consumer offset strictly after database updates succeed
    const lastMsg = messages[messages.length - 1];
    resolveOffset(lastMsg.offset);
    await commitOffsetsIfNecessary();
  }
}

export const classifierConsumer = new ClassifierConsumer();
