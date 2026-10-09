import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { query } from '@andx/db';
import type { CreatorEarningsResponse } from '@andx/contracts';

interface CreatorParams {
  id: string;
}

export const earningsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get<{ Params: CreatorParams }>('/v1/creators/:id/earnings', async (request, reply) => {
    const creatorId = request.params.id;

    // Query aggregated clip earnings grouped by campaign
    const res = await query<{
      campaign_id: string;
      clips: number;
      earned_cents: string;
    }>(
      `SELECT campaign_id, COUNT(*)::int AS clips, SUM(paid_cents)::bigint AS earned_cents
       FROM earnings.clip_earnings
       WHERE creator_id = $1 AND paid_cents > 0
       GROUP BY campaign_id
       ORDER BY campaign_id ASC`,
      [creatorId]
    );

    let totalCents = 0;
    const campaigns = res.rows.map((r) => {
      const earned = Number(r.earned_cents);
      totalCents += earned;
      return {
        campaign_id: r.campaign_id,
        clips: r.clips,
        earned_cents: earned,
      };
    });

    const response: CreatorEarningsResponse = {
      creator_id: creatorId,
      total_cents: totalCents,
      campaigns,
    };

    return reply.code(200).send(response);
  });
};
