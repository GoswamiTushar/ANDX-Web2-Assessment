import { createHash } from 'node:crypto';
import type { WireEvent, WireEventV1, WireEventV2Snapshot, WireEventV2Text } from '@andx/contracts';

// Validation bounds per Section 4.1
export const MIN_TIMESTAMP_MS = 1577836800000; // 2020-01-01T00:00:00.000Z
export const MAX_TIMESTAMP_MS = 4102444800000; // 2100-01-01T00:00:00.000Z
export const MAX_VIEWS = 2000000000;
export const MAX_CAPTION_LEN = 5000;
export const MAX_TRANSCRIPT_LEN = 20000;

// Regular expressions for ID formats
const EVENT_ID_REGEX = /^[0-9a-f]{16}$/;
const CLIP_ID_REGEX = /^c_\d{7}$/;
const CAMPAIGN_ID_REGEX = /^k_\d{5}$/;
const CREATOR_ID_REGEX = /^u_\d{6}$/;
const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type ValidationResult =
  | { valid: true; event: WireEvent }
  | { valid: false; reason: string; identity: string; raw_line: string };

/**
 * Computes identity for a malformed line per Section 4.3:
 * If the line is a JSON object with a string event_id, use that.
 * Otherwise, SHA-256 of the raw line.
 */
export function computeMalformedIdentity(rawLine: string, parsedObj?: any): string {
  if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
    if (typeof parsedObj.event_id === 'string' && parsedObj.event_id.length > 0) {
      return parsedObj.event_id;
    }
  }
  return createHash('sha256').update(rawLine).digest('hex');
}

/**
 * Validates whether an ISO string is a strictly valid UTC instant
 */
function isValidUtcIso(isoStr: string): { valid: boolean; ms?: number } {
  if (typeof isoStr !== 'string' || !ISO_TIMESTAMP_REGEX.test(isoStr)) {
    return { valid: false };
  }
  const date = new Date(isoStr);
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    return { valid: false };
  }
  // Verify real calendar date by round-tripping to ISO string
  if (date.toISOString() !== isoStr) {
    return { valid: false };
  }
  return { valid: true, ms };
}

/**
 * Implements all 10 checks of Section 4.1
 */
export function validateLine(rawLine: string): ValidationResult {
  // Strip trailing \r if present
  let cleanLine = rawLine;
  if (cleanLine.endsWith('\r')) {
    cleanLine = cleanLine.slice(0, -1);
  }

  let obj: any;
  try {
    obj = JSON.parse(cleanLine);
  } catch {
    return {
      valid: false,
      reason: 'invalid_json',
      identity: computeMalformedIdentity(cleanLine),
      raw_line: cleanLine,
    };
  }

  // 1. Must parse as a JSON object (not an array, not null)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {
      valid: false,
      reason: 'not_an_object',
      identity: computeMalformedIdentity(cleanLine, obj),
      raw_line: cleanLine,
    };
  }

  const identity = computeMalformedIdentity(cleanLine, obj);

  // 2. v is the number 1 or 2
  if (obj.v !== 1 && obj.v !== 2) {
    return { valid: false, reason: 'invalid_version', identity, raw_line: cleanLine };
  }

  // 3. event_id matches ^[0-9a-f]{16}$
  if (typeof obj.event_id !== 'string' || !EVENT_ID_REGEX.test(obj.event_id)) {
    return { valid: false, reason: 'invalid_event_id', identity, raw_line: cleanLine };
  }

  // 4. Type check
  if (obj.v === 1) {
    if (obj.type !== undefined && obj.type !== 'view_snapshot') {
      return { valid: false, reason: 'invalid_type_v1', identity, raw_line: cleanLine };
    }
  } else {
    // v === 2
    if (obj.type !== 'view_snapshot' && obj.type !== 'clip_text') {
      return { valid: false, reason: 'invalid_type_v2', identity, raw_line: cleanLine };
    }
  }

  // 5. clip_id matches ^c_\d{7}$ and campaign_id matches ^k_\d{5}$
  if (typeof obj.clip_id !== 'string' || !CLIP_ID_REGEX.test(obj.clip_id)) {
    return { valid: false, reason: 'invalid_clip_id', identity, raw_line: cleanLine };
  }
  if (typeof obj.campaign_id !== 'string' || !CAMPAIGN_ID_REGEX.test(obj.campaign_id)) {
    return { valid: false, reason: 'invalid_campaign_id', identity, raw_line: cleanLine };
  }

  // 6. For clip_text:
  if (obj.type === 'clip_text') {
    if (typeof obj.caption !== 'string' || obj.caption.length > MAX_CAPTION_LEN) {
      return { valid: false, reason: 'invalid_caption', identity, raw_line: cleanLine };
    }
    if (typeof obj.transcript !== 'string' || obj.transcript.length > MAX_TRANSCRIPT_LEN) {
      return { valid: false, reason: 'invalid_transcript', identity, raw_line: cleanLine };
    }
    return { valid: true, event: obj as WireEventV2Text };
  }

  // 7. For view_snapshot:
  // creator_id matches ^u_\d{6}$
  if (typeof obj.creator_id !== 'string' || !CREATOR_ID_REGEX.test(obj.creator_id)) {
    return { valid: false, reason: 'invalid_creator_id', identity, raw_line: cleanLine };
  }

  let observedMs: number;
  let emittedMs: number;
  let views: number;

  if (obj.v === 1) {
    // v1: observed_at and emitted_at match YYYY-MM-DDTHH:MM:SS.sssZ exactly and are real UTC instants
    const obs = isValidUtcIso(obj.observed_at);
    if (!obs.valid || obs.ms === undefined) {
      return { valid: false, reason: 'invalid_observed_at_v1', identity, raw_line: cleanLine };
    }
    const emit = isValidUtcIso(obj.emitted_at);
    if (!emit.valid || emit.ms === undefined) {
      return { valid: false, reason: 'invalid_emitted_at_v1', identity, raw_line: cleanLine };
    }
    observedMs = obs.ms;
    emittedMs = emit.ms;

    // views is a JSON integer
    if (typeof obj.views !== 'number' || !Number.isInteger(obj.views)) {
      return { valid: false, reason: 'invalid_views_v1', identity, raw_line: cleanLine };
    }
    views = obj.views;
  } else {
    // v2: observed_at_ms and emitted_at_ms are JSON integers
    if (typeof obj.observed_at_ms !== 'number' || !Number.isInteger(obj.observed_at_ms)) {
      return { valid: false, reason: 'invalid_observed_at_v2', identity, raw_line: cleanLine };
    }
    if (typeof obj.emitted_at_ms !== 'number' || !Number.isInteger(obj.emitted_at_ms)) {
      return { valid: false, reason: 'invalid_emitted_at_v2', identity, raw_line: cleanLine };
    }
    observedMs = obj.observed_at_ms;
    emittedMs = obj.emitted_at_ms;

    // view_count is a JSON integer
    if (typeof obj.view_count !== 'number' || !Number.isInteger(obj.view_count)) {
      return { valid: false, reason: 'invalid_view_count_v2', identity, raw_line: cleanLine };
    }
    views = obj.view_count;
  }

  // Both timestamps are within [2020-01-01T00:00:00.000Z, 2100-01-01T00:00:00.000Z)
  if (observedMs < MIN_TIMESTAMP_MS || observedMs >= MAX_TIMESTAMP_MS) {
    return { valid: false, reason: 'observed_out_of_range', identity, raw_line: cleanLine };
  }
  if (emittedMs < MIN_TIMESTAMP_MS || emittedMs >= MAX_TIMESTAMP_MS) {
    return { valid: false, reason: 'emitted_out_of_range', identity, raw_line: cleanLine };
  }

  // The view count is between 0 and 2,000,000,000 inclusive
  if (views < 0 || views > MAX_VIEWS) {
    return { valid: false, reason: 'views_out_of_range', identity, raw_line: cleanLine };
  }

  // emitted_at >= observed_at
  if (emittedMs < observedMs) {
    return { valid: false, reason: 'emitted_before_observed', identity, raw_line: cleanLine };
  }

  return { valid: true, event: obj as WireEventV1 | WireEventV2Snapshot };
}
