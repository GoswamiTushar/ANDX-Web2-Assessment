import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClient, mockPool, mockProducer } = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  };
  const producer = {
    send: vi.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]),
  };
  return {
    mockClient: client,
    mockPool: pool,
    mockProducer: producer,
  };
});

vi.mock('@andx/db', () => ({
  getPool: vi.fn(() => mockPool),
}));

vi.mock('../src/kafka.js', () => ({
  getProducer: vi.fn().mockResolvedValue(mockProducer),
}));

import { OutboxRelay } from '../src/outboxRelay.js';

describe('Aggregator - OutboxRelay', () => {
  let relay: OutboxRelay;

  beforeEach(() => {
    vi.clearAllMocks();
    relay = new OutboxRelay();
  });

  it('returns 0 when no pending outbox rows exist', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (sql.includes('SELECT id, clip_id, campaign_id')) {
        return { rows: [] };
      }
      if (sql === 'COMMIT') return {};
      return {};
    });

    const count = await relay.relayBatch();
    expect(count).toBe(0);
    expect(mockProducer.send).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('relays pending rows to Kafka and deletes them from outbox', async () => {
    const sampleRows = [
      {
        id: '1',
        clip_id: 'c_0000001',
        campaign_id: 'k_00001',
        creator_id: 'u_000001',
        observed_ms: '1785585600000',
        views: '50',
      },
    ];

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (sql.includes('SELECT id, clip_id, campaign_id')) {
        return { rows: sampleRows };
      }
      if (sql.includes('DELETE FROM aggregator.outbox_clip_views')) {
        return { rowCount: 1 };
      }
      if (sql === 'COMMIT') return {};
      return {};
    });

    const count = await relay.relayBatch();

    expect(count).toBe(1);
    expect(mockProducer.send).toHaveBeenCalledTimes(1);
    const sendArgs = mockProducer.send.mock.calls[0][0];
    expect(sendArgs.topic).toBe('aggregator.clip-views.v1');
    expect(sendArgs.messages[0].key).toBe('k_00001');

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM aggregator.outbox_clip_views'),
      [[1n]]
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
