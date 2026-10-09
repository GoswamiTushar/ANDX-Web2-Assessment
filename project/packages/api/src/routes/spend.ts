import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { query } from '@andx/db';
import type { SpendResponse, Campaign } from '@andx/contracts';

interface CampaignParams {
  id: string;
}

export const spendRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get<{ Params: CampaignParams }>('/v1/campaigns/:id/spend', async (request, reply) => {
    const campaignId = request.params.id;

    // 1. Verify campaign existence in api.campaigns
    const campRes = await query<Campaign>(
      `SELECT campaign_id, brand, cpm_cents, per_clip_cap_cents, budget_cents, 
              start_at::text, end_at::text 
       FROM api.campaigns 
       WHERE campaign_id = $1`,
      [campaignId]
    );

    if (campRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Campaign not found' });
    }

    const camp = campRes.rows[0];

    // 2. Query earnings.campaign_spend
    const spendRes = await query<{
      campaign_id: string;
      budget_cents: string;
      cpm_cents: number;
      per_clip_cap_cents: number;
      end_at: string;
      raw_earnings_cents: string;
      spend_cents: string;
      budget_exhausted: boolean;
      paid_clips: number;
    }>(
      `SELECT campaign_id, budget_cents, cpm_cents, per_clip_cap_cents, end_at::text,
              raw_earnings_cents, spend_cents, budget_exhausted, paid_clips
       FROM earnings.campaign_spend
       WHERE campaign_id = $1`,
      [campaignId]
    );

    if (spendRes.rows.length > 0) {
      const s = spendRes.rows[0];
      const response: SpendResponse = {
        campaign_id: s.campaign_id,
        budget_cents: Number(s.budget_cents),
        cpm_cents: Number(s.cpm_cents),
        per_clip_cap_cents: Number(s.per_clip_cap_cents),
        end_at: new Date(s.end_at).toISOString(),
        raw_earnings_cents: Number(s.raw_earnings_cents),
        spend_cents: Number(s.spend_cents),
        budget_exhausted: s.budget_exhausted,
        paid_clips: Number(s.paid_clips),
      };
      return reply.code(200).send(response);
    }

    // If registered but earnings has not produced results for it yet, return 200 with zeros
    const response: SpendResponse = {
      campaign_id: camp.campaign_id,
      budget_cents: Number(camp.budget_cents),
      cpm_cents: Number(camp.cpm_cents),
      per_clip_cap_cents: Number(camp.per_clip_cap_cents),
      end_at: new Date(camp.end_at).toISOString(),
      raw_earnings_cents: 0,
      spend_cents: 0,
      budget_exhausted: false,
      paid_clips: 0,
    };

    return reply.code(200).send(response);
  });
};
