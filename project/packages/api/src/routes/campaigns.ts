import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { query } from '@andx/db';
import type { Campaign } from '@andx/contracts';

export const campaignRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post('/v1/admin/campaigns', async (request, reply) => {
    const body = request.body;

    if (!Array.isArray(body) || body.length === 0) {
      return reply.code(400).send({ error: 'Body must be a non-empty array of campaign objects' });
    }

    const campaignIds: string[] = [];
    const brands: string[] = [];
    const cpmCents: number[] = [];
    const perClipCapCents: number[] = [];
    const budgetCents: bigint[] = [];
    const startAts: string[] = [];
    const endAts: string[] = [];

    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (
        !c ||
        typeof c.campaign_id !== 'string' ||
        typeof c.brand !== 'string' ||
        typeof c.cpm_cents !== 'number' ||
        typeof c.per_clip_cap_cents !== 'number' ||
        typeof c.budget_cents !== 'number' ||
        typeof c.start_at !== 'string' ||
        typeof c.end_at !== 'string'
      ) {
        return reply.code(400).send({
          error: `Invalid campaign object at index ${i}`,
        });
      }

      campaignIds.push(c.campaign_id);
      brands.push(c.brand);
      cpmCents.push(c.cpm_cents);
      perClipCapCents.push(c.per_clip_cap_cents);
      budgetCents.push(BigInt(c.budget_cents));
      startAts.push(c.start_at);
      endAts.push(c.end_at);
    }

    const sql = `
      INSERT INTO api.campaigns (
        campaign_id, brand, cpm_cents, per_clip_cap_cents, budget_cents, start_at, end_at
      )
      SELECT u.campaign_id, u.brand, u.cpm_cents, u.per_clip_cap_cents, u.budget_cents, u.start_at, u.end_at
      FROM UNNEST(
        $1::varchar[],
        $2::varchar[],
        $3::int[],
        $4::int[],
        $5::bigint[],
        $6::timestamptz[],
        $7::timestamptz[]
      ) AS u(campaign_id, brand, cpm_cents, per_clip_cap_cents, budget_cents, start_at, end_at)
      ON CONFLICT (campaign_id) DO UPDATE SET
        brand = EXCLUDED.brand,
        cpm_cents = EXCLUDED.cpm_cents,
        per_clip_cap_cents = EXCLUDED.per_clip_cap_cents,
        budget_cents = EXCLUDED.budget_cents,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at;
    `;

    await query(sql, [
      campaignIds,
      brands,
      cpmCents,
      perClipCapCents,
      budgetCents,
      startAts,
      endAts,
    ]);

    return reply.code(200).send({ upserted: body.length });
  });
};
