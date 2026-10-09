import type {
  WireEvent,
  WireEventV1,
  WireEventV2Snapshot,
  WireEventV2Text,
  NormalizedSnapshot,
  NormalizedClipText,
} from '@andx/contracts';

/**
 * Normalizes validated wire events into unified internal contracts.
 */
export function normalizeEvent(
  event: WireEvent
): { type: 'view_snapshot'; data: NormalizedSnapshot } | { type: 'clip_text'; data: NormalizedClipText } {
  if (event.v === 2 && event.type === 'clip_text') {
    const textEvent = event as WireEventV2Text;
    return {
      type: 'clip_text',
      data: {
        ver: 1,
        event_id: textEvent.event_id,
        clip_id: textEvent.clip_id,
        campaign_id: textEvent.campaign_id,
        caption: textEvent.caption,
        transcript: textEvent.transcript,
      },
    };
  }

  if (event.v === 1) {
    const v1 = event as WireEventV1;
    return {
      type: 'view_snapshot',
      data: {
        ver: 1,
        event_id: v1.event_id,
        clip_id: v1.clip_id,
        campaign_id: v1.campaign_id,
        creator_id: v1.creator_id,
        observed_ms: new Date(v1.observed_at).getTime(),
        emitted_ms: new Date(v1.emitted_at).getTime(),
        views: v1.views,
      },
    };
  }

  // event.v === 2 && event.type === 'view_snapshot'
  const v2 = event as WireEventV2Snapshot;
  return {
    type: 'view_snapshot',
    data: {
      ver: 1,
      event_id: v2.event_id,
      clip_id: v2.clip_id,
      campaign_id: v2.campaign_id,
      creator_id: v2.creator_id,
      observed_ms: v2.observed_at_ms,
      emitted_ms: v2.emitted_at_ms,
      views: v2.view_count,
    },
  };
}
