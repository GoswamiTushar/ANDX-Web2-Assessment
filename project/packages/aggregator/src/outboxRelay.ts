import { getPool } from '@andx/db';
import { getProducer } from './kafka.js';
import { config } from './config.js';
import type { ClipViewsChangedEvent } from '@andx/contracts';

export class OutboxRelay {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Polls and relays a batch of pending outbox rows to aggregator.clip-views.v1
   */
  public async relayBatch(): Promise<number> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const selectSql = `
        SELECT id, clip_id, campaign_id, creator_id, observed_ms, views
        FROM aggregator.outbox_clip_views
        WHERE status = 'PENDING'
        ORDER BY id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED;
      `;

      const res = await client.query<{
        id: string;
        clip_id: string;
        campaign_id: string;
        creator_id: string;
        observed_ms: string;
        views: string;
      }>(selectSql, [config.outboxBatchSize]);

      if (res.rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }

      const rows = res.rows;
      const idsToDelete: bigint[] = [];
      const kafkaMessages: Array<{ key: string; value: string }> = [];

      for (const r of rows) {
        idsToDelete.push(BigInt(r.id));
        const event: ClipViewsChangedEvent = {
          ver: 1,
          clip_id: r.clip_id,
          campaign_id: r.campaign_id,
          creator_id: r.creator_id,
          observed_ms: Number(r.observed_ms),
          views: Number(r.views),
        };
        kafkaMessages.push({
          key: r.campaign_id, // Partition by campaign_id for FIFO order per campaign
          value: JSON.stringify(event),
        });
      }

      // 1. Send to Kafka broker
      const producer = await getProducer();
      await producer.send({
        topic: config.topics.clipViews,
        messages: kafkaMessages,
      });

      // 2. Delete dispatched rows to maintain HOT update speed on table
      await client.query(
        `DELETE FROM aggregator.outbox_clip_views WHERE id = ANY($1::bigint[])`,
        [idsToDelete]
      );

      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[OutboxRelay] Error relaying outbox batch:', err);
      return 0;
    } finally {
      client.release();
    }
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const processed = await this.relayBatch();
      if (!this.isRunning) return;

      // If we processed a full batch, poll again immediately without waiting
      if (processed >= config.outboxBatchSize) {
        setImmediate(() => this.poll());
        return;
      }
    } catch (err) {
      console.error('[OutboxRelay] Polling loop error:', err);
    }

    if (this.isRunning) {
      this.timer = setTimeout(() => this.poll(), config.outboxPollIntervalMs);
    }
  }
}

export const outboxRelay = new OutboxRelay();
