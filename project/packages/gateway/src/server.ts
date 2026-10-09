import fastify, { FastifyInstance, FastifyError } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { eventsRoutes } from './routes/events.js';
import { config } from './config.js';

export function buildServer(): FastifyInstance {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: config.maxBodySizeBytes + 1024, // allow Fastify to receive up to bound
  });

  // Register NDJSON and plain text content-type parsers
  app.addContentTypeParser(
    ['application/x-ndjson', 'text/plain', 'application/json'],
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  // Fallback parser for any other content-type
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Register routes
  app.register(healthRoutes);
  app.register(eventsRoutes);

  // Custom 413 error handler
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.statusCode === 413 || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        error: 'Payload Too Large',
        message: 'Request body exceeds 8 MB limit',
      });
    }

    reply.status(error.statusCode || 500).send({
      error: error.name || 'Internal Server Error',
      message: error.message || 'An unexpected error occurred',
    });
  });

  return app;
}
