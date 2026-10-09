/**
 * ANDX Web2 Assessment - Shared Data Contracts & Event Schemas
 */

// Wire format: Schema v1 view snapshot
export interface WireEventV1 {
  v: 1;
  type?: 'view_snapshot';
  event_id: string;
  clip_id: string;
  campaign_id: string;
  creator_id: string;
  observed_at: string; // ISO 8601 UTC
  emitted_at: string;  // ISO 8601 UTC
  views: number;
}

// Wire format: Schema v2 view snapshot
export interface WireEventV2Snapshot {
  v: 2;
  type: 'view_snapshot';
  event_id: string;
  clip_id: string;
  campaign_id: string;
  creator_id: string;
  observed_at_ms: number; // Epoch ms
  emitted_at_ms: number;  // Epoch ms
  view_count: number;
}

// Wire format: Schema v2 clip text
export interface WireEventV2Text {
  v: 2;
  type: 'clip_text';
  event_id: string;
  clip_id: string;
  campaign_id: string;
  caption: string;
  transcript: string;
}

export type WireEvent = WireEventV1 | WireEventV2Snapshot | WireEventV2Text;

// Internal Normalized Snapshot Contract (Topic: ingest.snapshots.v1)
export interface NormalizedSnapshot {
  ver: 1;
  event_id: string;
  clip_id: string;
  campaign_id: string;
  creator_id: string;
  observed_ms: number;
  emitted_ms: number;
  views: number;
}

// Internal Normalized Clip Text Contract (Topic: ingest.clip-text.v1)
export interface NormalizedClipText {
  ver: 1;
  event_id: string;
  clip_id: string;
  campaign_id: string;
  caption: string;
  transcript: string;
}

// Invalid Event Contract (Topic: ingest.invalid.v1)
export interface InvalidEventRecord {
  ver: 1;
  identity: string; // event_id if present as string, or SHA-256 of raw line
  reason: 'invalid_schema';
  raw_line: string;
}

// Aggregator Outbox / Clip Views Changed Contract (Topic: aggregator.clip-views.v1)
export interface ClipViewsChangedEvent {
  ver: 1;
  clip_id: string;
  campaign_id: string;
  creator_id: string;
  observed_ms: number;
  views: number;
}

// DLQ Replay Command Contract (Topic: dlq.commands.v1)
export interface DlqReplayCommand {
  ver: 1;
  reason: 'unknown_campaign' | 'invalid_schema';
}

// Campaign Catalog Entry
export interface Campaign {
  campaign_id: string;
  brand: string;
  cpm_cents: number;
  per_clip_cap_cents: number;
  budget_cents: number;
  start_at: string;
  end_at: string;
}

// Classification Outcome
export type ClassificationOutcome =
  | { outcome: 'invalid_schema'; identity: string; raw_line: string }
  | { outcome: 'late'; event_id: string }
  | { outcome: 'unknown_campaign'; event: NormalizedSnapshot }
  | { outcome: 'accepted'; event: NormalizedSnapshot };

// API Response Models
export interface SpendResponse {
  campaign_id: string;
  budget_cents: number;
  cpm_cents: number;
  per_clip_cap_cents: number;
  end_at: string;
  raw_earnings_cents: number;
  spend_cents: number;
  budget_exhausted: boolean;
  paid_clips: number;
}

export interface CreatorEarningsResponse {
  creator_id: string;
  total_cents: number;
  campaigns: Array<{
    campaign_id: string;
    clips: number;
    earned_cents: number;
  }>;
}

export interface TopClipItem {
  clip_id: string;
  creator_id: string;
  views_gained: number;
}

export interface TopClipsResponse {
  campaign_id: string;
  from: string;
  to: string;
  items: TopClipItem[];
  next_cursor: string | null;
}

export interface StatsResponse {
  distinct_valid_events: number;
  late_dropped: number;
  dlq_pending: {
    invalid_schema: number;
    unknown_campaign: number;
  };
}

export interface RelevanceResponse {
  clip_id: string;
  campaign_id: string;
  on_brief: boolean;
  score: number;
  model: string;
}

export { loadEnv } from './env.js';

