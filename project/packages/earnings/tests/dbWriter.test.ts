import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClient, mockPool, mockQuery } = vi.hoisted(() => {
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
    mockQuery: vi.fn(),
  };
});

vi.mock('@andx/db', () => ({
  getPool: vi.fn(() => mockPool),
  query: mockQuery,
}));

import { DbWriter } from '../src/dbWriter.js';

describe('Earnings - DbWriter', () => {
  let writer: DbWriter;

  beforeEach(() => {
    vi.clearAllMocks();
    writer = new DbWriter();
  });

  it('returns null if campaign is not found in api.campaigns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await writer.recalculateCampaign('k_nonexistent');
    expect(res).toBeNull();
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('recalculates campaign spend and writes campaign_spend and clip_earnings atomically', async () => {
    // 1. Campaign lookup
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          campaign_id: 'k_00001',
          brand: 'Nike',
          cpm_cents: 1000, // $10 CPM (1 cent per view)
          per_clip_cap_cents: 10000, // $100 cap
          budget_cents: 5000, // $50 budget
          start_at: '2026-08-01T00:00:00Z',
          end_at: '2026-08-10T00:00:00Z',
        },
      ],
    });

    // 2. Clips lookup from aggregator.clip_state
    mockQuery.mockResolvedValueOnce({
      rows: [
        { clip_id: 'c_0000001', creator_id: 'u_000001', v_end_at: '2000' }, // 2000 views = $20
        { clip_id: 'c_0000002', creator_id: 'u_000002', v_end_at: '4000' }, // 4000 views = $40
      ],
    });

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (sql.includes('INSERT INTO earnings.campaign_spend')) return { rowCount: 1 };
      if (sql.includes('INSERT INTO earnings.clip_earnings')) return { rowCount: 2 };
      if (sql === 'COMMIT') return {};
      return {};
    });

    const res = await writer.recalculateCampaign('k_00001');

    expect(res).not.toBeNull();
    expect(res?.campaign_id).toBe('k_00001');
    expect(res?.budget_exhausted).toBe(true); // $60 earned > $50 budget
    expect(res?.spend_cents).toBe(5000); // exactly $50
    expect(res?.raw_earnings_cents).toBe(6000);

    // Verify transaction lifecycle
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);

    // Verify campaign_spend insert parameters
    const spendCall = mockClient.query.mock.calls.find((c: any) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO earnings.campaign_spend')
    );
    expect(spendCall).toBeDefined();
    expect(spendCall[1][0]).toBe('k_00001');
    expect(spendCall[1][6]).toBe(5000n); // spend_cents

    // Verify clip_earnings bulk insert
    const clipCall = mockClient.query.mock.calls.find((c: any) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO earnings.clip_earnings')
    );
    expect(clipCall).toBeDefined();
    expect(clipCall[1][0]).toBe('k_00001');
    expect(clipCall[1][1]).toEqual(['c_0000001', 'c_0000002']);
  });

  it('rolls back transaction on database failure', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          campaign_id: 'k_00001',
          budget_cents: 5000,
          cpm_cents: 100,
          per_clip_cap_cents: 1000,
          start_at: '2026-08-01T00:00:00Z',
          end_at: '2026-08-10T00:00:00Z',
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (sql.includes('INSERT INTO earnings.campaign_spend')) {
        throw new Error('Connection abruptly closed');
      }
      if (sql === 'ROLLBACK') return {};
      return {};
    });

    await expect(writer.recalculateCampaign('k_00001')).rejects.toThrow('Connection abruptly closed');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
