import type { FastifyPluginAsync } from 'fastify';
import { getCurrentLag } from '../backpressure.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'gateway',
      lag: getCurrentLag(),
    });
  });
};
