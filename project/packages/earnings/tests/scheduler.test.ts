import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRecalculate } = vi.hoisted(() => {
  return {
    mockRecalculate: vi.fn(),
  };
});

vi.mock('../src/dbWriter.js', () => ({
  dbWriter: {
    recalculateCampaign: mockRecalculate,
  },
}));

import { Scheduler } from '../src/scheduler.js';

describe('Earnings - Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = new Scheduler();
  });

  it('marks campaigns dirty and flushes them', async () => {
    mockRecalculate.mockResolvedValue({});

    scheduler.markDirty('k_00001');
    scheduler.markDirty('k_00002');
    scheduler.markDirty('k_00001'); // duplicate should deduplicate

    expect(scheduler.getPendingCount()).toBe(2);

    const processed = await scheduler.flushDirty();
    expect(processed).toBe(2);
    expect(mockRecalculate).toHaveBeenCalledWith('k_00001');
    expect(mockRecalculate).toHaveBeenCalledWith('k_00002');
    expect(scheduler.getPendingCount()).toBe(0);
  });

  it('processes specific campaigns directly and drains dirty queue', async () => {
    mockRecalculate.mockResolvedValue({});

    await scheduler.processCampaigns(['k_00003', 'k_00004']);

    expect(mockRecalculate).toHaveBeenCalledWith('k_00003');
    expect(mockRecalculate).toHaveBeenCalledWith('k_00004');
    expect(scheduler.getPendingCount()).toBe(0);
  });

  it('puts campaign back into dirty queue if calculation throws', async () => {
    mockRecalculate.mockRejectedValueOnce(new Error('DB failure'));

    scheduler.markDirty('k_fail');
    const processed = await scheduler.flushDirty();

    expect(processed).toBe(0);
    // Campaign should be retained for retry
    expect(scheduler.getPendingCount()).toBe(1);
  });
});
