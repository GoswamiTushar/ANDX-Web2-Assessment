import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockSendBatch, mockProducer, mockState } = vi.hoisted(() => {
  const sendBatch = vi.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]);
  const producer = {
    sendBatch,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const state = {
    decision: { allowed: true, currentLag: 0 } as any,
  };
  return {
    mockSendBatch: sendBatch,
    mockProducer: producer,
    mockState: state,
  };
});

vi.mock('../src/kafka.js', () => ({
  getProducer: vi.fn().mockResolvedValue(mockProducer),
  CompressionTypes: { GZIP: 1 },
  disconnectKafka: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/backpressure.js', () => ({
  checkBackpressure: vi.fn(() => mockState.decision),
  getCurrentLag: vi.fn(() => mockState.decision.currentLag),
  startLagMonitor: vi.fn(),
  stopLagMonitor: vi.fn(),
}));

import { buildServer } from '../src/server.js';

describe('Gateway - POST /v1/events', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.decision = { allowed: true, currentLag: 0 };
  });

  it('handles empty NDJSON body with accepted: 0, rejected: 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: '',
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload)).toEqual({ accepted: 0, rejected: 0 });
    expect(mockSendBatch).not.toHaveBeenCalled();
  });

  it('accepts and routes valid v1 snapshot events', async () => {
    const line = JSON.stringify({
      v: 1,
      event_id: '0123456789abcdef',
      clip_id: 'c_0000101',
      campaign_id: 'k_00001',
      creator_id: 'u_000001',
      views: 50,
      observed_at: '2026-08-01T12:00:00.000Z',
      emitted_at: '2026-08-01T12:00:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: line,
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload)).toEqual({ accepted: 1, rejected: 0 });
    expect(mockSendBatch).toHaveBeenCalledTimes(1);

    const callArgs = mockSendBatch.mock.calls[0][0];
    expect(callArgs.topicMessages).toHaveLength(1);
    expect(callArgs.topicMessages[0].topic).toBe('ingest.snapshots.v1');
    expect(callArgs.topicMessages[0].messages[0].key).toBe('c_0000101');
  });

  it('accepts and routes valid clip_text events to ingest.clip-text.v1', async () => {
    const line = JSON.stringify({
      v: 2,
      type: 'clip_text',
      event_id: 'abcdef0123456789',
      clip_id: 'c_0000202',
      campaign_id: 'k_00001',
      caption: 'Check out this awesome gaming clip!',
      transcript: 'Full audio transcript of the video clip.',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: line,
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload)).toEqual({ accepted: 1, rejected: 0 });
    expect(mockSendBatch).toHaveBeenCalledTimes(1);

    const callArgs = mockSendBatch.mock.calls[0][0];
    expect(callArgs.topicMessages[0].topic).toBe('ingest.clip-text.v1');
    expect(callArgs.topicMessages[0].messages[0].key).toBe('c_0000202');
  });

  it('rejects invalid schema line and routes to ingest.invalid.v1', async () => {
    const invalidLine = '{"v":1,"clip_id":"","views":"not-a-number"}';

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: invalidLine,
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload)).toEqual({ accepted: 0, rejected: 1 });
    expect(mockSendBatch).toHaveBeenCalledTimes(1);

    const callArgs = mockSendBatch.mock.calls[0][0];
    expect(callArgs.topicMessages[0].topic).toBe('ingest.invalid.v1');
    const msg = JSON.parse(callArgs.topicMessages[0].messages[0].value);
    expect(msg.reason).toBe('invalid_schema');
  });

  it('handles mixed batches with correct accepted and rejected counts', async () => {
    const validSnapshot = JSON.stringify({
      v: 1,
      event_id: '0123456789abcdef',
      clip_id: 'c_0000001',
      campaign_id: 'k_00001',
      creator_id: 'u_000001',
      views: 10,
      observed_at: '2026-08-01T12:00:00.000Z',
      emitted_at: '2026-08-01T12:00:00.000Z',
    });
    const validText = JSON.stringify({
      v: 2,
      type: 'clip_text',
      event_id: 'abcdef0123456789',
      clip_id: 'c_0000002',
      campaign_id: 'k_00001',
      caption: 'Great video',
      transcript: 'Transcript text',
    });
    const malformedJson = '{invalid json line';

    const body = `${validSnapshot}\n${validText}\n${malformedJson}\n`;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: body,
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload)).toEqual({ accepted: 2, rejected: 1 });
    expect(mockSendBatch).toHaveBeenCalledTimes(1);

    const callArgs = mockSendBatch.mock.calls[0][0];
    expect(callArgs.topicMessages).toHaveLength(3);
  });

  it('returns 413 when line count exceeds 10,000 lines', async () => {
    const line = '{"dummy":true}';
    const lines = new Array(10001).fill(line).join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: lines,
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(413);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain('Payload Too Large');
    expect(mockSendBatch).not.toHaveBeenCalled();
  });

  it('returns 429 when consumer lag reaches 400,000', async () => {
    mockState.decision = {
      allowed: false,
      statusCode: 429,
      retryAfter: 1,
      currentLag: 450000,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: '{"v":1}\n',
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('1');
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Too Many Requests');
    expect(body.lag).toBe(450000);
    expect(mockSendBatch).not.toHaveBeenCalled();
  });

  it('returns 503 when consumer lag reaches 1,500,000', async () => {
    mockState.decision = {
      allowed: false,
      statusCode: 503,
      retryAfter: 5,
      currentLag: 1600000,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: '{"v":1}\n',
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Service Unavailable');
    expect(body.lag).toBe(1600000);
    expect(mockSendBatch).not.toHaveBeenCalled();
  });

  it('returns 503 when broker fails to confirm delivery (Rule 5.2.7 durability)', async () => {
    mockSendBatch.mockRejectedValueOnce(new Error('Broker connection timed out'));

    const line = JSON.stringify({
      v: 1,
      event_id: '0123456789abcdef',
      clip_id: 'c_0000101',
      campaign_id: 'k_00001',
      creator_id: 'u_000001',
      views: 50,
      observed_at: '2026-08-01T12:00:00.000Z',
      emitted_at: '2026-08-01T12:00:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: line,
      headers: { 'content-type': 'application/x-ndjson' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('3');
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Service Unavailable');
    expect(body.message).toContain('Broker unavailable');
  });
});
