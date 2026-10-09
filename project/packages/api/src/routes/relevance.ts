import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { query } from '@andx/db';
import type { RelevanceResponse } from '@andx/contracts';

interface ClipParams {
  id: string;
}

export const relevanceRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get<{ Params: ClipParams }>('/v1/clips/:id/relevance', async (request, reply) => {
    const clipId = request.params.id;

    const res = await query<{
      clip_id: string;
      campaign_id: string;
      on_brief: boolean;
      score: number;
      model: string;
    }>(
      `SELECT clip_id, campaign_id, on_brief, score, model 
       FROM classifier.clip_relevance 
       WHERE clip_id = $1`,
      [clipId]
    );

    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'Clip not yet classified' });
    }

    const row = res.rows[0];
    const response: RelevanceResponse = {
      clip_id: row.clip_id,
      campaign_id: row.campaign_id,
      on_brief: row.on_brief,
      score: row.score,
      model: row.model,
    };

    return reply.code(200).send(response);
  });
};
