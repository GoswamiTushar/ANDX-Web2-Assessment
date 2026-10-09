import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { query } from '@andx/db';
import { getProducer } from '../kafka.js';
import { config } from '../config.js';
import type { DlqReplayCommand } from '@andx/contracts';

interface ReplayBody {
  reason?: string;
}

export const dlqRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post<{ Body: ReplayBody }>('/v1/dlq/replay', async (request, reply) => {
    const { reason } = request.body || {};

    if (reason !== 'unknown_campaign' && reason !== 'invalid_schema') {
      return reply.code(400).send({
        error: "Invalid or missing reason. Must be 'unknown_campaign' or 'invalid_schema'",
      });
    }

    // 1. Count matching entries waiting in aggregator.dlq_entries
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count 
       FROM aggregator.dlq_entries 
       WHERE reason = $1`,
      [reason]
    );

    const replayedCount = Number(countRes.rows[0]?.count || 0);

    // 2. Publish replay command to dlq.commands.v1
    const producer = await getProducer();
    const commandPayload: DlqReplayCommand = {
      ver: 1,
      reason,
    };

    await producer.send({
      topic: config.topicDlqCommands,
      messages: [
        {
          key: reason,
          value: JSON.stringify(commandPayload),
        },
      ],
    });

    return reply.code(202).send({ replayed: replayedCount });
  });
};
