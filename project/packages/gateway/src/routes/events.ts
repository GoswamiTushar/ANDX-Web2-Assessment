import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateLine, normalizeEvent } from '@andx/domain';
import { getProducer, CompressionTypes } from '../kafka.js';
import { checkBackpressure } from '../backpressure.js';
import { config } from '../config.js';

export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/events', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Backpressure check per Rule 5.2.8
    const bp = checkBackpressure();
    if (!bp.allowed) {
      reply.header('Retry-After', String(bp.retryAfter || 2));
      return reply.status(bp.statusCode || 429).send({
        error: bp.statusCode === 503 ? 'Service Unavailable' : 'Too Many Requests',
        message: 'Consumer lag threshold reached',
        lag: bp.currentLag,
      });
    }

    const rawBody = request.body;
    if (typeof rawBody !== 'string') {
      return reply.status(400).send({ error: 'Expected plain text NDJSON body' });
    }

    // 2. Check 8 MB limit
    if (Buffer.byteLength(rawBody, 'utf8') > config.maxBodySizeBytes) {
      return reply.status(413).send({ error: 'Payload Too Large: exceeds 8 MB' });
    }

    // 3. Split lines and ignore trailing \r and empty lines
    const rawLines = rawBody.split('\n');
    const linesToProcess: string[] = [];

    for (const rawLine of rawLines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.trim().length > 0) {
        linesToProcess.push(line);
      }
    }

    // Check 10,000 line limit
    if (linesToProcess.length > config.maxLineCount) {
      return reply.status(413).send({
        error: `Payload Too Large: ${linesToProcess.length} lines exceeds limit of ${config.maxLineCount}`,
      });
    }

    if (linesToProcess.length === 0) {
      return reply.status(202).send({ accepted: 0, rejected: 0 });
    }

    let acceptedCount = 0;
    let rejectedCount = 0;

    const snapshotMessages: Array<{ key: string; value: string }> = [];
    const textMessages: Array<{ key: string; value: string }> = [];
    const invalidMessages: Array<{ key: string; value: string }> = [];

    // 4. Validate and route every line independently (Section 4.1 & 6.1)
    for (const line of linesToProcess) {
      const val = validateLine(line);

      if (!val.valid) {
        rejectedCount++;
        invalidMessages.push({
          key: val.identity,
          value: JSON.stringify({
            ver: 1,
            identity: val.identity,
            reason: 'invalid_schema',
            raw_line: val.raw_line,
          }),
        });
      } else {
        acceptedCount++;
        const norm = normalizeEvent(val.event);

        if (norm.type === 'view_snapshot') {
          snapshotMessages.push({
            key: norm.data.clip_id,
            value: JSON.stringify(norm.data),
          });
        } else {
          // clip_text
          textMessages.push({
            key: norm.data.clip_id,
            value: JSON.stringify(norm.data),
          });
        }
      }
    }

    // 5. The 202 Durability Contract (Rule 5.2.7):
    // Produce all messages to Redpanda and await confirmation before returning 202
    try {
      const producer = await getProducer();

      const topicMessages: Array<{ topic: string; messages: Array<{ key: string; value: string }> }> = [];

      if (snapshotMessages.length > 0) {
        topicMessages.push({
          topic: config.topics.snapshots,
          messages: snapshotMessages,
        });
      }

      if (textMessages.length > 0) {
        topicMessages.push({
          topic: config.topics.clipText,
          messages: textMessages,
        });
      }

      if (invalidMessages.length > 0) {
        topicMessages.push({
          topic: config.topics.invalid,
          messages: invalidMessages,
        });
      }

      if (topicMessages.length > 0) {
        await producer.sendBatch({
          topicMessages,
          acks: -1, // Wait for full commit on disk
          compression: CompressionTypes.GZIP,
        });
      }

      // Safe on disk: return 202 per contract
      return reply.status(202).send({
        accepted: acceptedCount,
        rejected: rejectedCount,
      });
    } catch (err) {
      console.error('[Gateway] Failed to produce to Kafka broker:', err);
      // Never return 202 for data that could not be confirmed!
      reply.header('Retry-After', '3');
      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Broker unavailable or failed to confirm delivery',
      });
    }
  });
};
