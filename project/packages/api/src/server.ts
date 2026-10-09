import fastify, { FastifyInstance, FastifyError } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { campaignRoutes } from './routes/campaigns.js';
import { statsRoutes } from './routes/stats.js';
import { dlqRoutes } from './routes/dlq.js';
import { spendRoutes } from './routes/spend.js';
import { earningsRoutes } from './routes/earnings.js';
import { topClipsRoutes } from './routes/topClips.js';
import { relevanceRoutes } from './routes/relevance.js';

export function buildServer(): FastifyInstance {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: 50 * 1024 * 1024, // 50MB to accommodate large campaign JSON uploads
  });

  // Register all API routes
  app.register(healthRoutes);
  app.register(campaignRoutes);
  app.register(statsRoutes);
  app.register(dlqRoutes);
  app.register(spendRoutes);
  app.register(earningsRoutes);
  app.register(topClipsRoutes);
  app.register(relevanceRoutes);

  // Global Error Handler
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: error.message || 'Client Error',
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred',
    });
  });

  return app;
}
