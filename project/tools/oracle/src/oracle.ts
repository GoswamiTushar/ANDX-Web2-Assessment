import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { validateLine, normalizeEvent, classifySnapshot, calculateCampaignEarnings } from '@andx/domain';
import type {
  Campaign,
  NormalizedSnapshot,
  SpendResponse,
  CreatorEarningsResponse,
  TopClipsResponse,
  StatsResponse,
} from '@andx/contracts';

export interface OracleStats {
  distinct_valid_events: number;
  late_dropped: number;
  dlq_pending: {
    invalid_schema: number;
    unknown_campaign: number;
  };
}

export interface OraclePhaseOutput {
  stats: OracleStats;
  spend?: SpendResponse[];
  earnings?: CreatorEarningsResponse[];
}

export interface OracleResult {
  meta: {
    preset: string;
    seed: number;
    lines: number;
  };
  before_replay: OraclePhaseOutput;
  final: OraclePhaseOutput;
}

interface ClipSnapshotRecord {
  observed_ms: number;
  views: number;
}

interface ClipMeta {
  campaign_id: string;
  creator_id: string;
}

/**
 * In-memory reference oracle implementing the exact ANDX Web2 spec.
 */
export class Oracle {
  private campaigns = new Map<string, Campaign>();
  private lateCampaigns = new Map<string, Campaign>();

  // Dedup sets
  private seenEvents = new Set<string>();
  private dlqInvalid = new Set<string>(); // identities of invalid lines
  private dlqUnknown = new Map<string, NormalizedSnapshot>(); // event_id -> snapshot
  private lateEvents = new Set<string>();
  private acceptedEventsCount = 0;

  // Clip state: clip_id -> sorted snapshots
  private clipSnapshots = new Map<string, ClipSnapshotRecord[]>();
  private clipMetadata = new Map<string, ClipMeta>();

  private totalLines = 0;

  public loadCampaigns(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf8');
    const list: Campaign[] = JSON.parse(raw);
    for (const c of list) {
      this.campaigns.set(c.campaign_id, c);
    }
  }

  public loadLateCampaigns(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf8');
    const list: Campaign[] = JSON.parse(raw);
    for (const c of list) {
      this.lateCampaigns.set(c.campaign_id, c);
    }
  }

  public async processEventsFile(filePath: string): Promise<void> {
    const fileStream = fs.createReadStream(filePath, { highWaterMark: 1 << 22 });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line || line.trim().length === 0) continue;
      this.totalLines++;

      const val = validateLine(line);
      if (!val.valid) {
        this.dlqInvalid.add(val.identity);
        continue;
      }

      const normalized = normalizeEvent(val.event);
      if (normalized.type === 'clip_text') {
        // Valid clip_text events do not count in stats per Section 4.2
        continue;
      }

      const snap = normalized.data;

      // Section 4.3 Deduplication: identical event_id processed once
      if (this.seenEvents.has(snap.event_id)) {
        continue;
      }
      this.seenEvents.add(snap.event_id);

      // Section 4.2 Classification in order
      const classification = classifySnapshot(snap, (id) => this.campaigns.has(id));

      if (classification.outcome === 'late') {
        this.lateEvents.add(snap.event_id);
      } else if (classification.outcome === 'unknown_campaign') {
        this.dlqUnknown.set(snap.event_id, snap);
      } else if (classification.outcome === 'accepted') {
        this.recordAcceptedSnapshot(snap);
      }
    }
  }

  private recordAcceptedSnapshot(snap: NormalizedSnapshot): void {
    this.acceptedEventsCount++;

    // Record clip metadata
    if (!this.clipMetadata.has(snap.clip_id)) {
      this.clipMetadata.set(snap.clip_id, {
        campaign_id: snap.campaign_id,
        creator_id: snap.creator_id,
      });
    }

    // Record snapshot
    let snaps = this.clipSnapshots.get(snap.clip_id);
    if (!snaps) {
      snaps = [];
      this.clipSnapshots.set(snap.clip_id, snaps);
    }
    snaps.push({ observed_ms: snap.observed_ms, views: snap.views });
  }

  public replayUnknownCampaigns(): void {
    // 1. Add late campaigns to active catalog
    for (const [id, c] of this.lateCampaigns) {
      this.campaigns.set(id, c);
    }

    // 2. Replay all entries in dlqUnknown
    const entries = Array.from(this.dlqUnknown.entries());
    for (const [eventId, snap] of entries) {
      // Re-classify
      const classification = classifySnapshot(snap, (id) => this.campaigns.has(id));
      if (classification.outcome === 'accepted') {
        this.dlqUnknown.delete(eventId);
        this.recordAcceptedSnapshot(snap);
      }
    }
  }

  public getStats(): OracleStats {
    return {
      distinct_valid_events: this.acceptedEventsCount,
      late_dropped: this.lateEvents.size,
      dlq_pending: {
        invalid_schema: this.dlqInvalid.size,
        unknown_campaign: this.dlqUnknown.size,
      },
    };
  }

  /**
   * V(clip, t): view count of accepted snapshot with greatest observed_at strictly before t.
   */
  public getV(clipId: string, timeMs: number): number {
    const snaps = this.clipSnapshots.get(clipId);
    if (!snaps || snaps.length === 0) return 0;

    let maxObserved = -1;
    let latestViews = 0;

    for (const s of snaps) {
      if (s.observed_ms < timeMs && s.observed_ms > maxObserved) {
        maxObserved = s.observed_ms;
        latestViews = s.views;
      }
    }

    return latestViews;
  }

  public computeAllSpend(): SpendResponse[] {
    const results: SpendResponse[] = [];
    const sortedCampaigns = Array.from(this.campaigns.values()).sort((a, b) =>
      a.campaign_id.localeCompare(b.campaign_id)
    );

    for (const camp of sortedCampaigns) {
      const endAtMs = new Date(camp.end_at).getTime();

      // Collect all clips in this campaign
      const campaignClips: Array<{ clip_id: string; creator_id: string; views: number }> = [];
      for (const [clipId, meta] of this.clipMetadata) {
        if (meta.campaign_id === camp.campaign_id) {
          const v = this.getV(clipId, endAtMs);
          campaignClips.push({ clip_id: clipId, creator_id: meta.creator_id, views: v });
        }
      }

      const res = calculateCampaignEarnings(
        {
          campaign_id: camp.campaign_id,
          budget_cents: camp.budget_cents,
          cpm_cents: camp.cpm_cents,
          per_clip_cap_cents: camp.per_clip_cap_cents,
          end_at: camp.end_at,
        },
        campaignClips
      );

      results.push({
        campaign_id: res.campaign_id,
        budget_cents: res.budget_cents,
        cpm_cents: res.cpm_cents,
        per_clip_cap_cents: res.per_clip_cap_cents,
        end_at: res.end_at,
        raw_earnings_cents: res.raw_earnings_cents,
        spend_cents: res.spend_cents,
        budget_exhausted: res.budget_exhausted,
        paid_clips: res.paid_clips,
      });
    }

    return results;
  }
}
