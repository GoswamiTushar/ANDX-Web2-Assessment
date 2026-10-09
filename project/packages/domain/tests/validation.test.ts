import { describe, it, expect } from 'vitest';
import { validateLine, computeMalformedIdentity } from '../src/validation.js';

describe('Validation (Section 4.1 & 4.3)', () => {
  const validV1Line = JSON.stringify({
    v: 1,
    event_id: '7c5424d0e71521d4',
    clip_id: 'c_0010277',
    campaign_id: 'k_00015',
    creator_id: 'u_000814',
    observed_at: '2026-01-05T00:10:43.558Z',
    emitted_at: '2026-01-05T00:11:23.203Z',
    views: 10,
  });

  const validV2Snapshot = JSON.stringify({
    v: 2,
    type: 'view_snapshot',
    event_id: '0d9a51f2c37be801',
    clip_id: 'c_0004712',
    campaign_id: 'k_00015',
    creator_id: 'u_002513',
    observed_at_ms: 1767572203558,
    emitted_at_ms: 1767572283203,
    view_count: 3150,
  });

  const validV2Text = JSON.stringify({
    v: 2,
    type: 'clip_text',
    event_id: '5be0c2a1d4f79e13',
    clip_id: 'c_8000001',
    campaign_id: 'k_00007',
    caption: 'Setting up Nimbus Wallet in 60 seconds',
    transcript: 'okay so download nimbus wallet, tap create new wallet ...',
  });

  it('validates a correct v1 snapshot', () => {
    const res = validateLine(validV1Line);
    expect(res.valid).toBe(true);
  });

  it('validates a correct v2 snapshot', () => {
    const res = validateLine(validV2Snapshot);
    expect(res.valid).toBe(true);
  });

  it('validates a correct v2 clip_text', () => {
    const res = validateLine(validV2Text);
    expect(res.valid).toBe(true);
  });

  it('ignores a trailing \\r cleanly', () => {
    const res = validateLine(validV1Line + '\r');
    expect(res.valid).toBe(true);
  });

  it('rejects malformed non-JSON lines and hashes them', () => {
    const badLine = 'NOT_JSON_AT_ALL';
    const res = validateLine(badLine);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe('invalid_json');
      expect(res.identity).toBe(computeMalformedIdentity(badLine));
    }
  });

  it('uses event_id for JSON object even if schema is invalid', () => {
    const badObj = JSON.stringify({ event_id: 'abcdef1234567890', invalid_field: 123 });
    const res = validateLine(badObj);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.identity).toBe('abcdef1234567890');
    }
  });

  it('rejects invalid versions (e.g. v: 3 or v: 0)', () => {
    const line = JSON.stringify({ ...JSON.parse(validV1Line), v: 3 });
    const res = validateLine(line);
    expect(res.valid).toBe(false);
  });

  it('rejects malformed event_id length', () => {
    const line = JSON.stringify({ ...JSON.parse(validV1Line), event_id: 'tooshort' });
    const res = validateLine(line);
    expect(res.valid).toBe(false);
  });

  it('rejects invalid calendar dates like 2026-13-45T25:61:00.000Z', () => {
    const line = JSON.stringify({ ...JSON.parse(validV1Line), observed_at: '2026-13-45T25:61:00.000Z' });
    const res = validateLine(line);
    expect(res.valid).toBe(false);
  });

  it('rejects timestamps before 2020 or after 2100', () => {
    const oldLine = JSON.stringify({ ...JSON.parse(validV1Line), observed_at: '2019-12-31T23:59:59.999Z' });
    expect(validateLine(oldLine).valid).toBe(false);

    const futureLine = JSON.stringify({ ...JSON.parse(validV1Line), observed_at: '2100-01-01T00:00:00.000Z' });
    expect(validateLine(futureLine).valid).toBe(false);
  });

  it('rejects emitted_at strictly before observed_at', () => {
    const line = JSON.stringify({
      ...JSON.parse(validV1Line),
      observed_at: '2026-01-05T00:11:00.000Z',
      emitted_at: '2026-01-05T00:10:00.000Z',
    });
    const res = validateLine(line);
    expect(res.valid).toBe(false);
  });

  it('rejects negative views and views exceeding 2,000,000,000', () => {
    const neg = JSON.stringify({ ...JSON.parse(validV1Line), views: -1 });
    expect(validateLine(neg).valid).toBe(false);

    const tooMany = JSON.stringify({ ...JSON.parse(validV1Line), views: 2000000001 });
    expect(validateLine(tooMany).valid).toBe(false);
  });

  it('rejects captions longer than 5000 characters', () => {
    const longCaption = 'a'.repeat(5001);
    const line = JSON.stringify({ ...JSON.parse(validV2Text), caption: longCaption });
    expect(validateLine(line).valid).toBe(false);
  });
});
