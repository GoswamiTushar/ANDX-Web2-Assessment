import { describe, it, expect } from 'vitest';
import { normalizeEvent } from '../src/normalization.js';
import type { WireEventV1, WireEventV2Snapshot, WireEventV2Text } from '@andx/contracts';

describe('Normalization', () => {
  it('normalizes a v1 view snapshot', () => {
    const v1: WireEventV1 = {
      v: 1,
      event_id: '7c5424d0e71521d4',
      clip_id: 'c_0010277',
      campaign_id: 'k_00015',
      creator_id: 'u_000814',
      observed_at: '2026-01-05T00:10:43.558Z',
      emitted_at: '2026-01-05T00:11:23.203Z',
      views: 10,
    };

    const res = normalizeEvent(v1);
    expect(res.type).toBe('view_snapshot');
    expect(res.data.ver).toBe(1);
    expect(res.data.event_id).toBe('7c5424d0e71521d4');
    expect(res.data.observed_ms).toBe(new Date('2026-01-05T00:10:43.558Z').getTime());
    expect(res.data.emitted_ms).toBe(new Date('2026-01-05T00:11:23.203Z').getTime());
    expect(res.data.views).toBe(10);
  });

  it('normalizes a v2 view snapshot', () => {
    const v2: WireEventV2Snapshot = {
      v: 2,
      type: 'view_snapshot',
      event_id: '0d9a51f2c37be801',
      clip_id: 'c_0004712',
      campaign_id: 'k_00015',
      creator_id: 'u_002513',
      observed_at_ms: 1767572203558,
      emitted_at_ms: 1767572283203,
      view_count: 3150,
    };

    const res = normalizeEvent(v2);
    expect(res.type).toBe('view_snapshot');
    expect(res.data.views).toBe(3150);
    expect(res.data.observed_ms).toBe(1767572203558);
  });

  it('normalizes a v2 clip_text event', () => {
    const v2Text: WireEventV2Text = {
      v: 2,
      type: 'clip_text',
      event_id: '5be0c2a1d4f79e13',
      clip_id: 'c_8000001',
      campaign_id: 'k_00007',
      caption: 'Setting up Nimbus Wallet',
      transcript: 'okay download nimbus...',
    };

    const res = normalizeEvent(v2Text);
    expect(res.type).toBe('clip_text');
    expect(res.data.caption).toBe('Setting up Nimbus Wallet');
  });
});
