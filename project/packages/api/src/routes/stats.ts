import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { query } from '@andx/db';
import type { StatsResponse } from '@andx/contracts';

export const statsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/v1/stats', async (_request, reply) => {
    // 1. Fetch metrics from aggregator.stats
    const statsRes = await query<{ metric_name: string; metric_value: string }>(
      `SELECT metric_name, metric_value FROM aggregator.stats`
    );

    let distinctValidEvents = 0;
    let lateDropped = 0;

    for (const r of statsRes.rows) {
      if (r.metric_name === 'distinct_valid_events') {
        distinctValidEvents = Number(r.metric_value);
      } else if (r.metric_name === 'late_dropped') {
        lateDropped = Number(r.metric_value);
      }
    }

    // 2. Fetch pending counts grouped by reason from aggregator.dlq_entries
    const dlqRes = await query<{ reason: string; count: string }>(
      `SELECT reason, COUNT(*)::bigint AS count 
       FROM aggregator.dlq_entries 
       GROUP BY reason`
    );

    let invalidSchemaCount = 0;
    let unknownCampaignCount = 0;

    for (const r of dlqRes.rows) {
      if (r.reason === 'invalid_schema') {
        invalidSchemaCount = Number(r.count);
      } else if (r.reason === 'unknown_campaign') {
        unknownCampaignCount = Number(r.count);
      }
    }

    const response: StatsResponse = {
      distinct_valid_events: distinctValidEvents,
      late_dropped: lateDropped,
      dlq_pending: {
        invalid_schema: invalidSchemaCount,
        unknown_campaign: unknownCampaignCount,
      },
    };

    return reply.code(200).send(response);
  });
};
