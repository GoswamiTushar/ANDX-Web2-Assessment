import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/healthz', async (_request, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });
};
