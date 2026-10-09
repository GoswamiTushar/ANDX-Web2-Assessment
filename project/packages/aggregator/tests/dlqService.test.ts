import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedSnapshot } from '@andx/contracts';

const { mockClient, mockPool, mockSaveBatch, mockHasCampaign, mockRefreshAll } = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  };
  return {
    mockClient: client,
    mockPool: pool,
    mockSaveBatch: vi.fn().mockResolvedValue({ distinctValidCount: 1 }),
    mockHasCampaign: vi.fn(),
    mockRefreshAll: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@andx/db', () => ({
  getPool: vi.fn(() => mockPool),
}));

vi.mock('../src/snapshotRepo.js', () => ({
  snapshotRepo: {
    saveBatch: mockSaveBatch,
  },
}));

vi.mock('../src/campaignResolver.js', () => ({
  campaignResolver: {
    hasCampaign: mockHasCampaign,
    refreshAll: mockRefreshAll,
  },
}));

import { DlqService } from '../src/dlqService.js';

describe('Aggregator - DlqService', () => {
  let dlq: DlqService;

  beforeEach(() => {
    vi.clearAllMocks();
    dlq = new DlqService();
  });

  it('stores invalid schema events into aggregator.dlq_entries', async () => {
    await dlq.storeInvalidSchemaEvents([
      { identity: 'bad-id-1', raw_line: '{"v":1,"bad":true}' },
    ]);

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[0]).toContain("'invalid_schema'");
    expect(callArgs[1][0]).toEqual(['bad-id-1']);
  });

  it('stores unknown campaign snapshots into aggregator.dlq_entries', async () => {
    const snap: NormalizedSnapshot = {
      ver: 1,
      event_id: 'ev-unknown',
      clip_id: 'c_0000001',
      campaign_id: 'k_unregistered',
      creator_id: 'u_000001',
      observed_ms: 1785585600000,
      emitted_ms: 1785585600000,
      views: 10,
    };

    await dlq.storeUnknownCampaignEvents([snap]);

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[0]).toContain("'unknown_campaign'");
    expect(callArgs[1][0]).toEqual(['ev-unknown']);
  });

  it('replays unknown campaign entries when their campaign becomes registered', async () => {
    const snap: NormalizedSnapshot = {
      ver: 1,
      event_id: 'ev-replayed',
      clip_id: 'c_0000001',
      campaign_id: 'k_now_known',
      creator_id: 'u_000001',
      observed_ms: 1785585600000,
      emitted_ms: 1785585600000,
      views: 50,
    };

    mockClient.query.mockImplementation(async (sql: string) => {
      const clean = sql.replace(/\s+/g, ' ').trim();
      if (clean === 'BEGIN') return {};
      if (clean.includes('SELECT identity, raw_payload FROM aggregator.dlq_entries')) {
        return {
          rows: [{ identity: 'ev-replayed', raw_payload: snap }],
        };
      }
      if (clean.includes('DELETE FROM aggregator.dlq_entries')) {
        return { rowCount: 1, rows: [] };
      }
      if (clean === 'COMMIT') return {};
      return { rows: [] };
    });

    mockHasCampaign.mockReturnValue(true);

    const res = await dlq.handleReplayCommand({
      ver: 1,
      reason: 'unknown_campaign',
    });

    expect(res.replayed).toBe(1);
    expect(mockRefreshAll).toHaveBeenCalledTimes(1);
    expect(mockSaveBatch).toHaveBeenCalledWith([snap]);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM aggregator.dlq_entries'),
      [['ev-replayed']]
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });
});
