import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => {
  return {
    mockQuery: vi.fn(),
  };
});

vi.mock('@andx/db', () => ({
  query: mockQuery,
  getPool: vi.fn(),
}));

import { CampaignResolver } from '../src/campaignResolver.js';

describe('Aggregator - CampaignResolver', () => {
  let resolver: CampaignResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new CampaignResolver();
  });

  it('initializes and preloads all campaigns from api.campaigns', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          campaign_id: 'k_00001',
          brand: 'Nike',
          cpm_cents: 100,
          per_clip_cap_cents: 500,
          budget_cents: 10000,
          start_at: '2026-08-01T00:00:00Z',
          end_at: '2026-08-10T00:00:00Z',
        },
      ],
    });

    await resolver.init();

    expect(resolver.hasCampaign('k_00001')).toBe(true);
    expect(resolver.hasCampaign('k_99999')).toBe(false);
    expect(resolver.getAll().size).toBe(1);
  });

  it('caches positive hits so subsequent lookups do not query database', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          campaign_id: 'k_00002',
          brand: 'Adidas',
          cpm_cents: 150,
          per_clip_cap_cents: 600,
          budget_cents: 20000,
          start_at: '2026-08-01T00:00:00Z',
          end_at: '2026-08-10T00:00:00Z',
        },
      ],
    });

    // First lookup: queries database
    const res1 = await resolver.getCampaign('k_00002');
    expect(res1).not.toBeNull();
    expect(res1?.brand).toBe('Adidas');
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Second lookup: served directly from memory cache
    const res2 = await resolver.getCampaign('k_00002');
    expect(res2?.campaign_id).toBe('k_00002');
    expect(mockQuery).toHaveBeenCalledTimes(1); // No new DB query
  });

  it('NEVER caches negative misses: repeated lookups query DB each time', async () => {
    mockQuery.mockResolvedValue({
      rows: [],
    });

    // First lookup: returns null
    const res1 = await resolver.getCampaign('k_unknown');
    expect(res1).toBeNull();
    expect(resolver.hasCampaign('k_unknown')).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Second lookup: MUST query DB again in case campaign was just added
    const res2 = await resolver.getCampaign('k_unknown');
    expect(res2).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2); // Queried again!
  });
});
