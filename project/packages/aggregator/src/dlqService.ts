import { getPool } from '@andx/db';
import type { NormalizedSnapshot, DlqReplayCommand } from '@andx/contracts';
import { campaignResolver } from './campaignResolver.js';
import { snapshotRepo } from './snapshotRepo.js';

export class DlqService {
  /**
   * Stores invalid schema lines into aggregator.dlq_entries
   */
  public async storeInvalidSchemaEvents(
    entries: Array<{ identity: string; raw_line: string }>
  ): Promise<void> {
    if (entries.length === 0) return;

    const pool = getPool();
    const identities: string[] = [];
    const payloads: string[] = [];

    for (const e of entries) {
      identities.push(e.identity);
      payloads.push(
        JSON.stringify({
          ver: 1,
          identity: e.identity,
          reason: 'invalid_schema',
          raw_line: e.raw_line,
        })
      );
    }

    const sql = `
      INSERT INTO aggregator.dlq_entries (identity, reason, raw_payload)
      SELECT u.identity, 'invalid_schema', u.raw_payload::jsonb
      FROM UNNEST($1::varchar[], $2::text[]) AS u(identity, raw_payload)
      ON CONFLICT (identity) DO NOTHING;
    `;

    await pool.query(sql, [identities, payloads]);
  }

  /**
   * Stores unknown campaign snapshots into aggregator.dlq_entries
   */
  public async storeUnknownCampaignEvents(events: NormalizedSnapshot[]): Promise<void> {
    if (events.length === 0) return;

    const pool = getPool();
    const identities: string[] = [];
    const payloads: string[] = [];

    for (const e of events) {
      identities.push(e.event_id);
      payloads.push(JSON.stringify(e));
    }

    const sql = `
      INSERT INTO aggregator.dlq_entries (identity, reason, raw_payload)
      SELECT u.identity, 'unknown_campaign', u.raw_payload::jsonb
      FROM UNNEST($1::varchar[], $2::text[]) AS u(identity, raw_payload)
      ON CONFLICT (identity) DO NOTHING;
    `;

    await pool.query(sql, [identities, payloads]);
  }

  /**
   * Handles a replay command from dlq.commands.v1
   */
  public async handleReplayCommand(cmd: DlqReplayCommand): Promise<{ replayed: number }> {
    if (cmd.reason !== 'unknown_campaign') {
      return { replayed: 0 };
    }

    // 1. Refresh active campaign catalog
    await campaignResolver.refreshAll();

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const selectSql = `
        SELECT identity, raw_payload 
        FROM aggregator.dlq_entries 
        WHERE reason = 'unknown_campaign' 
        FOR UPDATE;
      `;

      const res = await client.query<{ identity: string; raw_payload: NormalizedSnapshot }>(selectSql);

      const eventsToReplay: NormalizedSnapshot[] = [];
      const identitiesToDelete: string[] = [];

      for (const row of res.rows) {
        const snap = row.raw_payload;
        if (campaignResolver.hasCampaign(snap.campaign_id)) {
          eventsToReplay.push(snap);
          identitiesToDelete.push(row.identity);
        }
      }

      if (eventsToReplay.length > 0) {
        // Save the replayed snapshots
        await snapshotRepo.saveBatch(eventsToReplay);

        // Delete from DLQ
        await client.query(
          `DELETE FROM aggregator.dlq_entries WHERE identity = ANY($1::varchar[])`,
          [identitiesToDelete]
        );
      }

      await client.query('COMMIT');
      console.log(`[DLQ] Replayed ${eventsToReplay.length} unknown_campaign events.`);
      return { replayed: eventsToReplay.length };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DLQ] Error replaying DLQ entries:', err);
      throw err;
    } finally {
      client.release();
    }
  }
}

export const dlqService = new DlqService();
