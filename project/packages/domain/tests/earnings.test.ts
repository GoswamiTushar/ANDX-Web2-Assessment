import { describe, it, expect } from 'vitest';
import { calculateCampaignEarnings, type CampaignParameters, type ClipViewInfo } from '../src/earnings.js';

describe('Earnings & Budget Allocation (Section 4.5)', () => {
  const campaign: CampaignParameters = {
    campaign_id: 'k_00001',
    budget_cents: 10000, // $100.00
    cpm_cents: 100,      // $1.00 CPM (10 cents per 1000 views)
    per_clip_cap_cents: 5000, // $50.00 cap per clip
    end_at: '2026-01-07T18:00:00.000Z',
  };

  it('allocates full earnings when total raw is under budget', () => {
    const clips: ClipViewInfo[] = [
      { clip_id: 'c_0000001', creator_id: 'u_000001', views: 20000 }, // earned: 20000 * 100 / 1000 = 2000 cents
      { clip_id: 'c_0000002', creator_id: 'u_000002', views: 30000 }, // earned: 30000 * 100 / 1000 = 3000 cents
    ];

    const result = calculateCampaignEarnings(campaign, clips);
    expect(result.raw_earnings_cents).toBe(5000);
    expect(result.spend_cents).toBe(5000);
    expect(result.budget_exhausted).toBe(false);
    expect(result.paid_clips).toBe(2);

    const c1 = result.allocations.find((c) => c.clip_id === 'c_0000001');
    const c2 = result.allocations.find((c) => c.clip_id === 'c_0000002');
    expect(c1?.paid_cents).toBe(2000n);
    expect(c2?.paid_cents).toBe(3000n);
  });

  it('enforces per_clip_cap_cents correctly', () => {
    const clips: ClipViewInfo[] = [
      { clip_id: 'c_0000001', creator_id: 'u_000001', views: 100000 }, // unCapped: 10000 cents > 5000 cap
    ];

    const result = calculateCampaignEarnings(campaign, clips);
    expect(result.raw_earnings_cents).toBe(5000);
    expect(result.allocations[0].paid_cents).toBe(5000n);
  });

  it('splits budget pro-rata with largest remainder rule when over budget', () => {
    // Budget = 100 cents
    const smallBudgetCampaign: CampaignParameters = {
      campaign_id: 'k_00002',
      budget_cents: 100,
      cpm_cents: 1000, // 1 cent per view
      per_clip_cap_cents: 1000,
      end_at: '2026-01-07T18:00:00.000Z',
    };

    // 3 clips: earned 100, 100, 100 => raw = 300 cents
    // Pro rata: 100 * 100 / 300 = 33 cents each, remainder = 100 mod 300 = 100 each
    // sumPaid = 99. left = 1 cent.
    // Remainders are equal (100, 100, 100), so tie is broken by clip_id ascending: c_0000001 gets the extra 1 cent!
    const clips: ClipViewInfo[] = [
      { clip_id: 'c_0000002', creator_id: 'u_000002', views: 100 },
      { clip_id: 'c_0000001', creator_id: 'u_000001', views: 100 },
      { clip_id: 'c_0000003', creator_id: 'u_000003', views: 100 },
    ];

    const result = calculateCampaignEarnings(smallBudgetCampaign, clips);
    expect(result.raw_earnings_cents).toBe(300);
    expect(result.spend_cents).toBe(100); // Exactly equals budget
    expect(result.budget_exhausted).toBe(true);

    const c1 = result.allocations.find((c) => c.clip_id === 'c_0000001');
    const c2 = result.allocations.find((c) => c.clip_id === 'c_0000002');
    const c3 = result.allocations.find((c) => c.clip_id === 'c_0000003');

    // c_0000001 wins tie-breaker!
    expect(c1?.paid_cents).toBe(34n);
    expect(c2?.paid_cents).toBe(33n);
    expect(c3?.paid_cents).toBe(33n);

    // Total spend must sum to 100 exactly
    const totalSpend = (c1?.paid_cents ?? 0n) + (c2?.paid_cents ?? 0n) + (c3?.paid_cents ?? 0n);
    expect(totalSpend).toBe(100n);
  });

  it('handles large numbers safely without float precision overflow', () => {
    const hugeCampaign: CampaignParameters = {
      campaign_id: 'k_00003',
      budget_cents: 500_000_000n, // $5 Million budget
      cpm_cents: 500,
      per_clip_cap_cents: 2_000_000_000,
      end_at: '2026-01-07T18:00:00.000Z',
    };

    const clips: ClipViewInfo[] = [
      { clip_id: 'c_0000001', creator_id: 'u_000001', views: 500_000_000 },
      { clip_id: 'c_0000002', creator_id: 'u_000002', views: 500_000_000 },
      { clip_id: 'c_0000003', creator_id: 'u_000003', views: 500_000_000 },
    ];

    const result = calculateCampaignEarnings(hugeCampaign, clips);
    expect(result.raw_earnings_cents).toBe(750_000_000);
    expect(result.spend_cents).toBe(500_000_000);
    expect(result.budget_exhausted).toBe(true);
    expect(result.paid_clips).toBe(3);

    const totalPaid = result.allocations.reduce((acc, c) => acc + c.paid_cents, 0n);
    expect(totalPaid).toBe(500_000_000n);
  });
});
