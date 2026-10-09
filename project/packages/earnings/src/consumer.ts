import type { EachBatchPayload } from 'kafkajs';
import { getConsumer } from './kafka.js';
import { config } from './config.js';
import { scheduler } from './scheduler.js';
import type { ClipViewsChangedEvent } from '@andx/contracts';

export class EarningsConsumer {
  private isRunning = false;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const consumer = await getConsumer();

    await consumer.subscribe({
      topic: config.topicClipViews,
      fromBeginning: true,
    });

    console.log(`[Earnings] Subscribed to topic: ${config.topicClipViews}`);

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

    const dirtyCampaignIds = new Set<string>();

    for (const msg of messages) {
      if (!msg.value) continue;
      try {
        const event: ClipViewsChangedEvent = JSON.parse(msg.value.toString('utf8'));
        if (event.campaign_id) {
          dirtyCampaignIds.add(event.campaign_id);
        }
      } catch (err) {
        console.error('[Earnings] Corrupt clip views payload in topic:', err);
      }
    }

    if (dirtyCampaignIds.size > 0) {
      // Recompute and persist all dirty campaigns in this batch
      await scheduler.processCampaigns(Array.from(dirtyCampaignIds));
    }

    await heartbeat();

    // Commit consumer offset strictly after database update succeeds
    const lastMsg = messages[messages.length - 1];
    resolveOffset(lastMsg.offset);
    await commitOffsetsIfNecessary();
  }
}

export const earningsConsumer = new EarningsConsumer();
