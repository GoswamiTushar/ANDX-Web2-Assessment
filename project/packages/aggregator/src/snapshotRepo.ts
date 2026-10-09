import { getPool } from '@andx/db';
import type { NormalizedSnapshot } from '@andx/contracts';

export interface BatchSaveResult {
  distinctValidCount: number;
}

export class SnapshotRepo {
  /**
   * Saves a batch of accepted snapshots atomically into PostgreSQL.
   * Performs:
   * 1. UNNEST bulk insert into aggregator.snapshots (ON CONFLICT DO NOTHING)
   * 2. Bulk upsert into aggregator.clip_state with exact V(clip, end_at)
   * 3. Bulk insert into aggregator.outbox_clip_views
   * 4. Updates distinct_valid_events stats counter
   */
  public async saveBatch(events: NormalizedSnapshot[]): Promise<BatchSaveResult> {
    if (events.length === 0) {
      return { distinctValidCount: 0 };
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Bulk UNNEST into aggregator.snapshots
      const clipIds: string[] = [];
      const observedAts: string[] = [];
      const views: bigint[] = [];
      const campaignIds: string[] = [];
      const eventIds: string[] = [];

      for (const e of events) {
        clipIds.push(e.clip_id);
        observedAts.push(new Date(e.observed_ms).toISOString());
        views.push(BigInt(e.views));
        campaignIds.push(e.campaign_id);
        eventIds.push(e.event_id);
      }

      const insertSnapshotsSql = `
        INSERT INTO aggregator.snapshots (clip_id, observed_at, views, campaign_id, event_id)
        SELECT u.clip_id, u.observed_at, u.views, u.campaign_id, u.event_id
        FROM UNNEST(
          $1::varchar[], 
          $2::timestamptz[], 
          $3::bigint[], 
          $4::varchar[], 
          $5::varchar[]
        ) AS u(clip_id, observed_at, views, campaign_id, event_id)
        ON CONFLICT (clip_id, event_id) DO NOTHING
        RETURNING clip_id, event_id;
      `;

      const snapshotInsertRes = await client.query(insertSnapshotsSql, [
        clipIds,
        observedAts,
        views,
        campaignIds,
        eventIds,
      ]);

      const distinctValidCount = snapshotInsertRes.rowCount ?? 0;

      // 2. Coalesce by clip_id to get the latest snapshot per clip in this batch
      const clipBatchMap = new Map<
        string,
        {
          clip_id: string;
          campaign_id: string;
          creator_id: string;
          max_observed_ms: number;
          latest_views: bigint;
        }
      >();

      for (const e of events) {
        const existing = clipBatchMap.get(e.clip_id);
        if (!existing || e.observed_ms > existing.max_observed_ms) {
          clipBatchMap.set(e.clip_id, {
            clip_id: e.clip_id,
            campaign_id: e.campaign_id,
            creator_id: e.creator_id,
            max_observed_ms: e.observed_ms,
            latest_views: BigInt(e.views),
          });
        }
      }

      const distinctClips = Array.from(clipBatchMap.values());
      const stateClipIds: string[] = [];
      const stateCampaignIds: string[] = [];
      const stateCreatorIds: string[] = [];
      const stateLatestObservedAts: string[] = [];
      const outboxObservedMs: bigint[] = [];
      const outboxViews: bigint[] = [];

      for (const c of distinctClips) {
        stateClipIds.push(c.clip_id);
        stateCampaignIds.push(c.campaign_id);
        stateCreatorIds.push(c.creator_id);
        stateLatestObservedAts.push(new Date(c.max_observed_ms).toISOString());
        outboxObservedMs.push(BigInt(c.max_observed_ms));
        outboxViews.push(c.latest_views);
      }

      // 3. Upsert into aggregator.clip_state with index-accelerated V(clip, end_at)
      const upsertStateSql = `
        INSERT INTO aggregator.clip_state (clip_id, campaign_id, creator_id, v_end_at, latest_observed_at, updated_at)
        SELECT 
          u.clip_id, 
          u.campaign_id, 
          u.creator_id, 
          COALESCE(
            (SELECT s.views 
             FROM aggregator.snapshots s
             JOIN api.campaigns c ON c.campaign_id = u.campaign_id
             WHERE s.clip_id = u.clip_id 
               AND s.observed_at < c.end_at
             ORDER BY s.observed_at DESC 
             LIMIT 1),
            0
          ), 
          u.latest_observed_at, 
          NOW()
        FROM UNNEST(
          $1::varchar[], 
          $2::varchar[], 
          $3::varchar[], 
          $4::timestamptz[]
        ) AS u(clip_id, campaign_id, creator_id, latest_observed_at)
        ON CONFLICT (clip_id) DO UPDATE SET
          latest_observed_at = GREATEST(aggregator.clip_state.latest_observed_at, EXCLUDED.latest_observed_at),
          v_end_at = COALESCE(
            (SELECT s.views 
             FROM aggregator.snapshots s
             JOIN api.campaigns c ON c.campaign_id = EXCLUDED.campaign_id
             WHERE s.clip_id = EXCLUDED.clip_id 
               AND s.observed_at < c.end_at
             ORDER BY s.observed_at DESC 
             LIMIT 1),
            0
          ),
          updated_at = NOW();
      `;

      await client.query(upsertStateSql, [
        stateClipIds,
        stateCampaignIds,
        stateCreatorIds,
        stateLatestObservedAts,
      ]);

      // 4. Bulk insert into aggregator.outbox_clip_views
      const insertOutboxSql = `
        INSERT INTO aggregator.outbox_clip_views (clip_id, campaign_id, creator_id, observed_ms, views, status)
        SELECT u.clip_id, u.campaign_id, u.creator_id, u.observed_ms, u.views, 'PENDING'
        FROM UNNEST(
          $1::varchar[], 
          $2::varchar[], 
          $3::varchar[], 
          $4::bigint[], 
          $5::bigint[]
        ) AS u(clip_id, campaign_id, creator_id, observed_ms, views);
      `;

      await client.query(insertOutboxSql, [
        stateClipIds,
        stateCampaignIds,
        stateCreatorIds,
        outboxObservedMs,
        outboxViews,
      ]);

      // 5. Update atomic stats counter
      if (distinctValidCount > 0) {
        await client.query(
          `UPDATE aggregator.stats 
           SET metric_value = metric_value + $1 
           WHERE metric_name = 'distinct_valid_events'`,
          [distinctValidCount]
        );
      }

      await client.query('COMMIT');
      return { distinctValidCount };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[SnapshotRepo] Transaction failed, rolled back:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Registers late events with deduplication and updates the late_dropped counter.
   */
  public async recordLateDropped(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const pool = getPool();
    const res = await pool.query<{ event_id: string }>(
      `INSERT INTO aggregator.late_events (event_id)
       SELECT UNNEST($1::varchar[])
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id;`,
      [eventIds]
    );

    const distinctLate = res.rowCount ?? 0;
    if (distinctLate > 0) {
      await pool.query(
        `UPDATE aggregator.stats 
         SET metric_value = metric_value + $1 
         WHERE metric_name = 'late_dropped'`,
        [distinctLate]
      );
    }
    return distinctLate;
  }

  /**
   * Increments the late_dropped counter in aggregator.stats.
   */
  public async incrementLateDropped(count: number): Promise<void> {
    if (count <= 0) return;
    const pool = getPool();
    await pool.query(
      `UPDATE aggregator.stats 
       SET metric_value = metric_value + $1 
       WHERE metric_name = 'late_dropped'`,
      [count]
    );
  }
}

export const snapshotRepo = new SnapshotRepo();
