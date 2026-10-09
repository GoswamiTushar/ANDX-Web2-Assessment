import type { EachBatchPayload } from 'kafkajs';
import { getConsumer } from './kafka.js';
import { config } from './config.js';
import { campaignResolver } from './campaignResolver.js';
import { snapshotRepo } from './snapshotRepo.js';
import { dlqService } from './dlqService.js';
import { classifySnapshot } from '@andx/domain';
import type { NormalizedSnapshot, DlqReplayCommand } from '@andx/contracts';

export class AggregatorConsumer {
  private isRunning = false;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const consumer = await getConsumer();

    // Subscribe to all 3 relevant topics
    await consumer.subscribe({
      topics: [
        config.topics.snapshots,
        config.topics.invalid,
        config.topics.commands,
      ],
      fromBeginning: true,
    });

    console.log('[Aggregator] Subscribed to topics:', [
      config.topics.snapshots,
      config.topics.invalid,
      config.topics.commands,
    ]);

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
    const topic = batch.topic;
    const messages = batch.messages;

    if (messages.length === 0) return;

    try {
      if (topic === config.topics.snapshots) {
        await this.processSnapshotsBatch(messages, heartbeat);
      } else if (topic === config.topics.invalid) {
        await this.processInvalidBatch(messages);
      } else if (topic === config.topics.commands) {
        await this.processCommandsBatch(messages);
      }

      // Mark all messages in the batch as resolved
      const lastMsg = messages[messages.length - 1];
      resolveOffset(lastMsg.offset);
      await commitOffsetsIfNecessary();
    } catch (err) {
      console.error(`[Aggregator] Error processing batch on topic ${topic}:`, err);
      throw err; // Trigger Kafka retry
    }
  }

  private async processSnapshotsBatch(
    messages: Array<{ value: Buffer | null; offset: string }>,
    heartbeat: () => Promise<void>
  ): Promise<void> {
    const acceptedEvents: NormalizedSnapshot[] = [];
    const unknownCampaignEvents: NormalizedSnapshot[] = [];
    const lateEventIds: string[] = [];
    const batchUnknownCampaigns = new Set<string>();

    for (const msg of messages) {
      if (!msg.value) continue;
      try {
        const snap: NormalizedSnapshot = JSON.parse(msg.value.toString('utf8'));

        // Check if campaign is known; if not in cache, query DB once per batch
        let isKnown = false;
        if (!batchUnknownCampaigns.has(snap.campaign_id)) {
          isKnown = campaignResolver.hasCampaign(snap.campaign_id);
          if (!isKnown) {
            const fetched = await campaignResolver.getCampaign(snap.campaign_id);
            isKnown = fetched !== null;
            if (!isKnown) {
              batchUnknownCampaigns.add(snap.campaign_id);
            }
          }
        }

        // Section 4.2 Classification in strict order
        const classification = classifySnapshot(snap, () => isKnown);

        if (classification.outcome === 'late') {
          lateEventIds.push(snap.event_id);
        } else if (classification.outcome === 'unknown_campaign') {
          unknownCampaignEvents.push(snap);
        } else if (classification.outcome === 'accepted') {
          acceptedEvents.push(snap);
        }
      } catch (err) {
        console.error('[Aggregator] Corrupt snapshot payload in topic:', err);
      }
    }

    // 1. Process accepted snapshots (atomic UNNEST + state + outbox + stats)
    if (acceptedEvents.length > 0) {
      await snapshotRepo.saveBatch(acceptedEvents);
    }

    // 2. Store unknown campaign snapshots in DLQ
    if (unknownCampaignEvents.length > 0) {
      await dlqService.storeUnknownCampaignEvents(unknownCampaignEvents);
    }

    // 3. Register late dropped events with deduplication
    if (lateEventIds.length > 0) {
      await snapshotRepo.recordLateDropped(lateEventIds);
    }

    await heartbeat();
  }

  private async processInvalidBatch(
    messages: Array<{ value: Buffer | null }>
  ): Promise<void> {
    const invalidEntries: Array<{ identity: string; raw_line: string }> = [];

    for (const msg of messages) {
      if (!msg.value) continue;
      try {
        const parsed = JSON.parse(msg.value.toString('utf8'));
        if (parsed && parsed.identity) {
          invalidEntries.push({
            identity: parsed.identity,
            raw_line: parsed.raw_line || '',
          });
        }
      } catch (err) {
        console.error('[Aggregator] Corrupt invalid event payload in topic:', err);
      }
    }

    if (invalidEntries.length > 0) {
      await dlqService.storeInvalidSchemaEvents(invalidEntries);
    }
  }

  private async processCommandsBatch(
    messages: Array<{ value: Buffer | null }>
  ): Promise<void> {
    for (const msg of messages) {
      if (!msg.value) continue;
      try {
        const cmd: DlqReplayCommand = JSON.parse(msg.value.toString('utf8'));
        await dlqService.handleReplayCommand(cmd);
      } catch (err) {
        console.error('[Aggregator] Corrupt command payload in topic:', err);
      }
    }
  }
}

export const aggregatorConsumer = new AggregatorConsumer();
