import type { SpendResponse } from '@andx/contracts';

export interface ClipViewInfo {
  clip_id: string;
  creator_id: string;
  views: number | bigint;
}

export interface CampaignParameters {
  campaign_id: string;
  budget_cents: number | bigint;
  cpm_cents: number;
  per_clip_cap_cents: number;
  end_at: string;
}

export interface ClipEarningsAllocation {
  clip_id: string;
  creator_id: string;
  earned_cents: bigint;
  paid_cents: bigint;
}

export interface CampaignEarningsResult {
  campaign_id: string;
  budget_cents: number;
  cpm_cents: number;
  per_clip_cap_cents: number;
  end_at: string;
  raw_earnings_cents: number;
  spend_cents: number;
  budget_exhausted: boolean;
  paid_clips: number;
  allocations: ClipEarningsAllocation[];
}

/**
 * Calculates campaign earnings and pro-rata budget allocation per Section 4.5 using exact BigInt math.
 */
export function calculateCampaignEarnings(
  campaign: CampaignParameters,
  clips: ClipViewInfo[]
): CampaignEarningsResult {
  const budgetCents = BigInt(campaign.budget_cents);
  const cpmCents = BigInt(campaign.cpm_cents);
  const capCents = BigInt(campaign.per_clip_cap_cents);

  let rawTotal = 0n;

  // Step 1: earned_i = min( per_clip_cap_cents, floor( V(i, end_at) * cpm_cents / 1000 ) )
  interface IntermediateClip {
    clip_id: string;
    creator_id: string;
    earned: bigint;
    paid: bigint;
    remainder: bigint;
  }

  const calculatedClips: IntermediateClip[] = clips.map((clip) => {
    const v = BigInt(clip.views);
    const unCapped = (v * cpmCents) / 1000n; // integer division is floor
    const earned = unCapped > capCents ? capCents : unCapped;
    rawTotal += earned;
    return {
      clip_id: clip.clip_id,
      creator_id: clip.creator_id,
      earned,
      paid: 0n,
      remainder: 0n,
    };
  });

  // Step 2: Under-budget vs Over-budget allocation
  if (rawTotal <= budgetCents) {
    let paidClipsCount = 0;
    const allocations: ClipEarningsAllocation[] = calculatedClips.map((c) => {
      if (c.earned > 0n) {
        paidClipsCount++;
      }
      return {
        clip_id: c.clip_id,
        creator_id: c.creator_id,
        earned_cents: c.earned,
        paid_cents: c.earned,
      };
    });

    return {
      campaign_id: campaign.campaign_id,
      budget_cents: Number(budgetCents),
      cpm_cents: campaign.cpm_cents,
      per_clip_cap_cents: campaign.per_clip_cap_cents,
      end_at: campaign.end_at,
      raw_earnings_cents: Number(rawTotal),
      spend_cents: Number(rawTotal),
      budget_exhausted: false,
      paid_clips: paidClipsCount,
      allocations,
    };
  }

  // Step 3: raw > budget_cents -> pro-rata split with exact remainder rule
  // paid_i      = floor( earned_i * budget_cents / raw )
  // remainder_i = (earned_i * budget_cents) mod raw
  // left        = budget_cents - sum(paid_i)
  let sumPaid = 0n;
  for (const c of calculatedClips) {
    const prod = c.earned * budgetCents;
    c.paid = prod / rawTotal;
    c.remainder = prod % rawTotal;
    sumPaid += c.paid;
  }

  const left = Number(budgetCents - sumPaid);

  // Give 1 extra cent to each of the left clips with largest remainder_i, ties broken by clip_id ascending
  calculatedClips.sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    return a.clip_id.localeCompare(b.clip_id);
  });

  for (let i = 0; i < left; i++) {
    calculatedClips[i].paid += 1n;
  }

  let paidClipsCount = 0;
  const allocations: ClipEarningsAllocation[] = calculatedClips.map((c) => {
    if (c.paid > 0n) {
      paidClipsCount++;
    }
    return {
      clip_id: c.clip_id,
      creator_id: c.creator_id,
      earned_cents: c.earned,
      paid_cents: c.paid,
    };
  });

  return {
    campaign_id: campaign.campaign_id,
    budget_cents: Number(budgetCents),
    cpm_cents: campaign.cpm_cents,
    per_clip_cap_cents: campaign.per_clip_cap_cents,
    end_at: campaign.end_at,
    raw_earnings_cents: Number(rawTotal),
    spend_cents: Number(budgetCents), // Spend equals budget exactly
    budget_exhausted: true,
    paid_clips: paidClipsCount,
    allocations,
  };
}
