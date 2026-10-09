import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { Oracle } from '../src/oracle.js';

describe('Oracle Reference Verification against small-seed7.json', () => {
  const dataDir = path.resolve(__dirname, '../../../../test-data');
  const expectedFile = path.resolve(__dirname, '../../../../web2-kit/expected/small-seed7.json');

  it('exactly reproduces small-seed7 stats and spend', async () => {
    if (!fs.existsSync(dataDir)) {
      console.warn('test-data not found, skipping full oracle test');
      return;
    }

    const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
    const oracle = new Oracle();

    // 1. Load initial campaigns
    oracle.loadCampaigns(path.join(dataDir, 'campaigns.json'));
    oracle.loadLateCampaigns(path.join(dataDir, 'campaigns-late.json'));

    // 2. Process events stream
    await oracle.processEventsFile(path.join(dataDir, 'events.ndjson'));

    // 3. Verify before_replay stats
    const beforeStats = oracle.getStats();
    expect(beforeStats.distinct_valid_events).toBe(expected.before_replay.stats.distinct_valid_events);
    expect(beforeStats.late_dropped).toBe(expected.before_replay.stats.late_dropped);
    expect(beforeStats.dlq_pending.invalid_schema).toBe(expected.before_replay.stats.dlq_pending.invalid_schema);
    expect(beforeStats.dlq_pending.unknown_campaign).toBe(expected.before_replay.stats.dlq_pending.unknown_campaign);

    // 4. Replay late campaigns
    oracle.replayUnknownCampaigns();

    // 5. Verify final stats
    const finalStats = oracle.getStats();
    expect(finalStats.distinct_valid_events).toBe(expected.final.stats.distinct_valid_events);
    expect(finalStats.late_dropped).toBe(expected.final.stats.late_dropped);
    expect(finalStats.dlq_pending.invalid_schema).toBe(expected.final.stats.dlq_pending.invalid_schema);
    expect(finalStats.dlq_pending.unknown_campaign).toBe(expected.final.stats.dlq_pending.unknown_campaign);

    // 6. Verify spend on sample campaigns
    const spendResults = oracle.computeAllSpend();
    const spendMap = new Map(spendResults.map((s) => [s.campaign_id, s]));

    for (const want of expected.final.spend) {
      const got = spendMap.get(want.campaign_id);
      expect(got).toBeDefined();
      expect(got?.budget_cents).toBe(want.budget_cents);
      expect(got?.raw_earnings_cents).toBe(want.raw_earnings_cents);
      expect(got?.spend_cents).toBe(want.spend_cents);
      expect(got?.budget_exhausted).toBe(want.budget_exhausted);
      expect(got?.paid_clips).toBe(want.paid_clips);
    }
  }, 60000); // 60s timeout for streaming 455k lines
});
