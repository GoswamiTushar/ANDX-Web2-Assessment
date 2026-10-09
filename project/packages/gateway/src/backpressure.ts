import { getAdmin } from './kafka.js';
import { config } from './config.js';

let currentLag = 0;
let isPolling = false;
let timerId: NodeJS.Timeout | null = null;
let consecutiveErrors = 0;

export async function pollLag(): Promise<number> {
  try {
    const admin = await getAdmin();
    const topic = config.topics.snapshots;

    // 1. Fetch latest high watermark offsets for the topic
    const topicOffsets = await admin.fetchTopicOffsets(topic);

    // 2. Fetch committed offsets for aggregator consumer group
    const groupOffsetsResult = await admin.fetchOffsets({
      groupId: config.targetConsumerGroup,
      topics: [topic],
    });

    const topicEntry = groupOffsetsResult.find((t) => t.topic === topic);
    if (!topicEntry) {
      currentLag = 0;
      consecutiveErrors = 0;
      return currentLag;
    }

    const committedMap = new Map<number, bigint>();
    for (const p of topicEntry.partitions) {
      if (p.offset !== '-1') {
        committedMap.set(p.partition, BigInt(p.offset));
      }
    }

    let totalLag = 0n;
    for (const p of topicOffsets) {
      const high = BigInt(p.high);
      const low = BigInt(p.low);
      const committed = committedMap.get(p.partition);

      if (committed !== undefined) {
        if (high > committed) {
          totalLag += high - committed;
        }
      } else {
        // Consumer has not committed yet, lag is distance from low to high
        if (high > low) {
          totalLag += high - low;
        }
      }
    }

    currentLag = Number(totalLag);
    consecutiveErrors = 0;
    return currentLag;
  } catch (err) {
    consecutiveErrors++;
    console.warn(`[LagMonitor] Failed to fetch lag (consecutive errors: ${consecutiveErrors}):`, err);
    return currentLag;
  }
}

export function startLagMonitor(): void {
  if (isPolling) return;
  isPolling = true;

  const run = async () => {
    if (!isPolling) return;
    await pollLag();
    if (isPolling) {
      timerId = setTimeout(run, config.lagPollIntervalMs);
    }
  };

  run();
}

export function stopLagMonitor(): void {
  isPolling = false;
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
}

export interface BackpressureDecision {
  allowed: boolean;
  statusCode?: 429 | 503;
  retryAfter?: number;
  currentLag: number;
}

/**
 * Evaluates whether the incoming request should be accepted or throttled per Rule 5.2.8.
 */
export function checkBackpressure(): BackpressureDecision {
  // If broker polling has continuously failed, fail closed with 503
  if (consecutiveErrors >= 5) {
    return {
      allowed: false,
      statusCode: 503,
      retryAfter: 5,
      currentLag,
    };
  }

  if (currentLag >= config.lagThreshold503) {
    return {
      allowed: false,
      statusCode: 503,
      retryAfter: 5,
      currentLag,
    };
  }

  if (currentLag >= config.lagThreshold429) {
    return {
      allowed: false,
      statusCode: 429,
      retryAfter: 1,
      currentLag,
    };
  }

  return {
    allowed: true,
    currentLag,
  };
}

export function getCurrentLag(): number {
  return currentLag;
}
