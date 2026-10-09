import { describe, it, expect } from 'vitest';
import { classifySnapshot, SIX_HOURS_MS } from '../src/classification.js';
import type { NormalizedSnapshot } from '@andx/contracts';

describe('Classification (Section 4.2)', () => {
  const baseSnapshot: NormalizedSnapshot = {
    ver: 1,
    event_id: '7c5424d0e71521d4',
    clip_id: 'c_0010277',
    campaign_id: 'k_00015',
    creator_id: 'u_000814',
    observed_ms: 1767572200000,
    emitted_ms: 1767572210000,
    views: 500,
  };

  it('classifies normal event as accepted when campaign is registered', () => {
    const res = classifySnapshot(baseSnapshot, (id) => id === 'k_00015');
    expect(res.outcome).toBe('accepted');
  });

  it('drops late event when emitted_ms - observed_ms > 6 hours (21,600,000 ms)', () => {
    const lateSnapshot: NormalizedSnapshot = {
      ...baseSnapshot,
      emitted_ms: baseSnapshot.observed_ms + SIX_HOURS_MS + 1,
    };
    const res = classifySnapshot(lateSnapshot, () => true);
    expect(res.outcome).toBe('late');
  });

  it('does NOT drop event exactly on the 6 hours boundary (strictly more than 6h rule)', () => {
    const boundarySnapshot: NormalizedSnapshot = {
      ...baseSnapshot,
      emitted_ms: baseSnapshot.observed_ms + SIX_HOURS_MS,
    };
    const res = classifySnapshot(boundarySnapshot, () => true);
    expect(res.outcome).toBe('accepted');
  });

  it('sends to unknown_campaign when campaign is missing from catalog', () => {
    const res = classifySnapshot(baseSnapshot, () => false);
    expect(res.outcome).toBe('unknown_campaign');
  });

  it('prioritizes late check over unknown_campaign check', () => {
    // If an event is both late AND has unknown campaign, it must be dropped as late!
    const lateAndUnknown: NormalizedSnapshot = {
      ...baseSnapshot,
      emitted_ms: baseSnapshot.observed_ms + SIX_HOURS_MS + 1000,
    };
    const res = classifySnapshot(lateAndUnknown, () => false);
    expect(res.outcome).toBe('late');
  });
});
