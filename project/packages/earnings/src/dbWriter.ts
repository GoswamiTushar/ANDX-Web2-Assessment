import { getPool, query } from '@andx/db';
import { calculateCampaignEarnings, type CampaignEarningsResult } from '@andx/domain';
import type { Campaign } from '@andx/contracts';

export class DbWriter {
  /**
   * Recalculates spend and per-clip earnings for a given campaign,
   * then updates PostgreSQL inside an atomic transaction.
   */
  public async recalculateCampaign(campaignId: string): Promise<CampaignEarningsResult | null> {
    // 1. Fetch campaign details
    const campRes = await query<Campaign>(
      `SELECT campaign_id, brand, cpm_cents, per_clip_cap_cents, budget_cents, 
              start_at::text, end_at::text 
       FROM api.campaigns 
       WHERE campaign_id = $1`,
      [campaignId]
    );

    if (campRes.rows.length === 0) {
      return null;
    }

    const camp = campRes.rows[0];

    // 2. Fetch all clips for this campaign from aggregator.clip_state
    const clipsRes = await query<{
      clip_id: string;
      creator_id: string;
      v_end_at: string;
    }>(
      `SELECT clip_id, creator_id, v_end_at 
       FROM aggregator.clip_state 
       WHERE campaign_id = $1`,
      [campaignId]
    );

    const clipInfos = clipsRes.rows.map((r) => ({
      clip_id: r.clip_id,
      creator_id: r.creator_id,
      views: BigInt(r.v_end_at),
    }));

    // 3. Compute BigInt earnings & pro-rata split per Section 4.5
    const result = calculateCampaignEarnings(
      {
        campaign_id: camp.campaign_id,
        budget_cents: BigInt(camp.budget_cents),
        cpm_cents: Number(camp.cpm_cents),
        per_clip_cap_cents: Number(camp.per_clip_cap_cents),
        end_at: camp.end_at,
      },
      clipInfos
    );

    // 4. Save to database atomically
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 4a. Upsert earnings.campaign_spend
      const spendSql = `
        INSERT INTO earnings.campaign_spend (
          campaign_id, budget_cents, cpm_cents, per_clip_cap_cents, end_at,
          raw_earnings_cents, spend_cents, budget_exhausted, paid_clips, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (campaign_id) DO UPDATE SET
          budget_cents = EXCLUDED.budget_cents,
          cpm_cents = EXCLUDED.cpm_cents,
          per_clip_cap_cents = EXCLUDED.per_clip_cap_cents,
          end_at = EXCLUDED.end_at,
          raw_earnings_cents = EXCLUDED.raw_earnings_cents,
          spend_cents = EXCLUDED.spend_cents,
          budget_exhausted = EXCLUDED.budget_exhausted,
          paid_clips = EXCLUDED.paid_clips,
          updated_at = NOW();
      `;

      await client.query(spendSql, [
        result.campaign_id,
        BigInt(result.budget_cents),
        result.cpm_cents,
        result.per_clip_cap_cents,
        result.end_at,
        BigInt(result.raw_earnings_cents),
        BigInt(result.spend_cents),
        result.budget_exhausted,
        result.paid_clips,
      ]);

      // 4b. Bulk UNNEST upsert earnings.clip_earnings
      if (result.allocations.length > 0) {
        const clipIds: string[] = [];
        const creatorIds: string[] = [];
        const earnedCents: bigint[] = [];
        const paidCents: bigint[] = [];

        for (const alloc of result.allocations) {
          clipIds.push(alloc.clip_id);
          creatorIds.push(alloc.creator_id);
          earnedCents.push(alloc.earned_cents);
          paidCents.push(alloc.paid_cents);
        }

        const clipSql = `
          INSERT INTO earnings.clip_earnings (
            clip_id, campaign_id, creator_id, earned_cents, paid_cents, updated_at
          )
          SELECT u.clip_id, $1, u.creator_id, u.earned_cents, u.paid_cents, NOW()
          FROM UNNEST(
            $2::varchar[], 
            $3::varchar[], 
            $4::bigint[], 
            $5::bigint[]
          ) AS u(clip_id, creator_id, earned_cents, paid_cents)
          ON CONFLICT (clip_id) DO UPDATE SET
            earned_cents = EXCLUDED.earned_cents,
            paid_cents = EXCLUDED.paid_cents,
            updated_at = NOW();
        `;

        await client.query(clipSql, [
          result.campaign_id,
          clipIds,
          creatorIds,
          earnedCents,
          paidCents,
        ]);
      }

      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[DbWriter] Failed to update earnings for campaign ${campaignId}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Catches up on all registered campaigns that need initial spend records.
   */
  public async catchUpAllCampaigns(): Promise<number> {
    const res = await query<{ campaign_id: string }>(
      `SELECT campaign_id FROM api.campaigns`
    );

    let count = 0;
    for (const row of res.rows) {
      await this.recalculateCampaign(row.campaign_id);
      count++;
    }
    return count;
  }
}

export const dbWriter = new DbWriter();
