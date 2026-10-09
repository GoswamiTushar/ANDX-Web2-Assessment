import { query } from '@andx/db';
import type { Campaign } from '@andx/contracts';

export class CampaignResolver {
  private cache = new Map<string, Campaign>();
  private lastRefreshMs = 0;

  /**
   * Preloads all campaigns from the database into memory cache.
   */
  public async init(): Promise<void> {
    await this.refreshAll();
  }

  /**
   * Refreshes all active campaigns from api.campaigns.
   */
  public async refreshAll(): Promise<void> {
    this.lastRefreshMs = Date.now();
    const res = await query<Campaign>(
      `SELECT campaign_id, brand, cpm_cents, per_clip_cap_cents, budget_cents, 
              start_at::text, end_at::text 
       FROM api.campaigns`
    );
    for (const row of res.rows) {
      this.cache.set(row.campaign_id, {
        campaign_id: row.campaign_id,
        brand: row.brand,
        cpm_cents: Number(row.cpm_cents),
        per_clip_cap_cents: Number(row.per_clip_cap_cents),
        budget_cents: Number(row.budget_cents),
        start_at: row.start_at,
        end_at: row.end_at,
      });
    }
  }

  /**
   * Resolves a campaign by ID.
   * Caches positive hits. NEVER caches misses.
   */
  public async getCampaign(campaignId: string): Promise<Campaign | null> {
    const cached = this.cache.get(campaignId);
    if (cached) {
      return cached;
    }

    // Cache miss: query PostgreSQL directly
    const res = await query<Campaign>(
      `SELECT campaign_id, brand, cpm_cents, per_clip_cap_cents, budget_cents, 
              start_at::text, end_at::text 
       FROM api.campaigns 
       WHERE campaign_id = $1`,
      [campaignId]
    );

    if (res.rows.length === 0) {
      // NEVER cache misses per Rule 4.2 & Section 5.2.5
      return null;
    }

    const row = res.rows[0];
    const campaign: Campaign = {
      campaign_id: row.campaign_id,
      brand: row.brand,
      cpm_cents: Number(row.cpm_cents),
      per_clip_cap_cents: Number(row.per_clip_cap_cents),
      budget_cents: Number(row.budget_cents),
      start_at: row.start_at,
      end_at: row.end_at,
    };

    // Cache positive hit
    this.cache.set(campaignId, campaign);
    return campaign;
  }

  public hasCampaign(campaignId: string): boolean {
    return this.cache.has(campaignId);
  }

  public getAll(): Map<string, Campaign> {
    return this.cache;
  }
}

export const campaignResolver = new CampaignResolver();
