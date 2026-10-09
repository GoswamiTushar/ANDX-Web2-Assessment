import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedSnapshot } from '@andx/contracts';

const { mockClient, mockPool } = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  };
  return { mockClient: client, mockPool: pool };
});

vi.mock('@andx/db', () => ({
  getPool: vi.fn(() => mockPool),
  query: vi.fn(),
}));

import { SnapshotRepo } from '../src/snapshotRepo.js';

describe('Aggregator - SnapshotRepo', () => {
  let repo: SnapshotRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new SnapshotRepo();
  });

  it('handles empty events array without opening database transaction', async () => {
    const res = await repo.saveBatch([]);
    expect(res).toEqual({ distinctValidCount: 0 });
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('executes atomic batch UNNEST insert, state upsert, and outbox write', async () => {
    const sampleEvents: NormalizedSnapshot[] = [
      {
        ver: 1,
        event_id: 'ev-1',
        clip_id: 'c_0000001',
        campaign_id: 'k_00001',
        creator_id: 'u_000001',
        observed_ms: 1785585600000,
        emitted_ms: 1785585600000,
        views: 100,
      },
      {
        ver: 1,
        event_id: 'ev-2',
        clip_id: 'c_0000001',
        campaign_id: 'k_00001',
        creator_id: 'u_000001',
        observed_ms: 1785585700000,
        emitted_ms: 1785585700000,
        views: 200,
      },
    ];

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (sql.includes('INSERT INTO aggregator.snapshots')) {
        return { rowCount: 2 };
      }
      if (sql.includes('INSERT INTO aggregator.clip_state')) {
        return { rowCount: 1 };
      }
      if (sql.includes('INSERT INTO aggregator.outbox_clip_views')) {
        return { rowCount: 1 };
      }
      if (sql.includes('UPDATE aggregator.stats')) {
        return { rowCount: 1 };
      }
      if (sql === 'COMMIT') return {};
      return {};
    });

    const res = await repo.saveBatch(sampleEvents);

    expect(res.distinctValidCount).toBe(2);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);

    // Verify snapshots insert was called with unnested arrays
    const snapshotCall = mockClient.query.mock.calls.find((c: any) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO aggregator.snapshots')
    );
    expect(snapshotCall).toBeDefined();
    const [clipIds, , views] = snapshotCall[1];
    expect(clipIds).toEqual(['c_0000001', 'c_0000001']);
    expect(views).toEqual([100n, 200n]);

    // Verify clip_state upsert coalesced to latest event for c_0000001
    const stateCall = mockClient.query.mock.calls.find((c: any) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO aggregator.clip_state')
    );
    expect(stateCall).toBeDefined();
    expect(stateCall[1][0]).toEqual(['c_0000001']); // 1 distinct clip
  });

  it('rolls back transaction on error and releases connection', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (sql.includes('INSERT INTO aggregator.snapshots')) {
        throw new Error('Database connection reset');
      }
      if (sql === 'ROLLBACK') return {};
      return {};
    });

    const sampleEvents: NormalizedSnapshot[] = [
      {
        ver: 1,
        event_id: 'ev-1',
        clip_id: 'c_0000001',
        campaign_id: 'k_00001',
        creator_id: 'u_000001',
        observed_ms: 1785585600000,
        emitted_ms: 1785585600000,
        views: 100,
      },
    ];

    await expect(repo.saveBatch(sampleEvents)).rejects.toThrow('Database connection reset');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('increments late_dropped counter in aggregator.stats', async () => {
    await repo.incrementLateDropped(5);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE metric_name = 'late_dropped'"),
      [5]
    );
  });
});
