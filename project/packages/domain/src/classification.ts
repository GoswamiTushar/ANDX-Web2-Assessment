import type { NormalizedSnapshot, ClassificationOutcome } from '@andx/contracts';

export const SIX_HOURS_MS = 21600000; // 6 * 3600 * 1000 ms

/**
 * Classifies a normalized view snapshot according to Section 4.2 in strict order:
 * 1. invalid_schema (handled before normalization)
 * 2. late -> dropped (emitted_ms - observed_ms > 21,600,000 ms)
 * 3. unknown_campaign -> DLQ (if campaign is not registered)
 * 4. accepted -> stored & used for earnings
 */
export function classifySnapshot(
  snapshot: NormalizedSnapshot,
  isCampaignRegistered: (campaignId: string) => boolean
): ClassificationOutcome {
  // Rule 2: late -> dropped (strictly more than 6 hours)
  if (snapshot.emitted_ms - snapshot.observed_ms > SIX_HOURS_MS) {
    return { outcome: 'late', event_id: snapshot.event_id };
  }

  // Rule 3: unknown_campaign -> DLQ
  if (!isCampaignRegistered(snapshot.campaign_id)) {
    return { outcome: 'unknown_campaign', event: snapshot };
  }

  // Rule 4: accepted
  return { outcome: 'accepted', event: snapshot };
}
