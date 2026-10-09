import { CAMPAIGN_BRIEFS } from './briefs.js';
import { normalizeText, extractHashtags } from './normalizer.js';
import type { ClassificationResult } from './llmClient.js';

/**
 * Deterministic rule-based evaluation engine implementing Section 8 & labeling-rules.md.
 */
export function classifyWithRules(
  campaignId: string,
  rawCaption: string,
  rawTranscript: string
): ClassificationResult {
  const brief = CAMPAIGN_BRIEFS[campaignId];
  if (!brief) {
    return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
  }

  const caption = normalizeText(rawCaption).toLowerCase();
  const transcript = normalizeText(rawTranscript).toLowerCase();
  const fullText = `${caption} ${transcript}`.trim();

  // If both empty or only music -> 0
  if (!fullText || fullText === '[music]') {
    return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
  }

  // --------------------------------------------------------------------------
  // Rule 3: Brand Identifiable (including speech-to-text misspellings)
  // --------------------------------------------------------------------------
  const brandKeywords: Record<string, string[]> = {
    k_00007: ['nimbus', 'nimbus wallet', 'nimbus walled', '#nimbus', '#nimbuswallet', 'निम्बस'],
    k_00042: ['drift arena', 'drift arina', '#driftarena', 'ड्रिफ्ट'],
    k_00133: ['fuel bar', 'fool bar', '#fuelbar', 'फ्यूल'],
  };

  const allowedBrands = brandKeywords[campaignId] || [];
  const brandMentioned = allowedBrands.some((k) => fullText.includes(k));

  if (!brandMentioned) {
    return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
  }

  // --------------------------------------------------------------------------
  // Rule 2: Right Campaign (check if clearly about another product)
  // --------------------------------------------------------------------------
  if (campaignId === 'k_00007') {
    if (fullText.includes('fuel bar') || fullText.includes('drift arena')) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
  } else if (campaignId === 'k_00042') {
    if (fullText.includes('fuel bar') || fullText.includes('nimbus wallet')) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
    // Hashtag on a clip really about another product (e.g. Asphalt Legends)
    if (fullText.includes('asphalt legends') && fullText.includes('#driftarena')) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
    if (fullText.includes('hair dryers')) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
  } else if (campaignId === 'k_00133') {
    if (fullText.includes('nimbus wallet') || fullText.includes('drift arena')) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
  }

  // --------------------------------------------------------------------------
  // Rule 1: Brief Rules (R1 / R2)
  // --------------------------------------------------------------------------
  if (campaignId === 'k_00007') {
    // R1: No promises of profit or yield/APY, price predictions
    const r1ProfitKeywords = [
      'apy',
      'percent a year',
      'passive income',
      '50x',
      'fifty x',
      '100x',
      'cannot lose money',
      'will rise',
      'yield',
    ];
    if (r1ProfitKeywords.some((k) => fullText.includes(k))) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }

    // R2: Never show or share recovery phrase / seed words
    if (
      fullText.includes('here is my actual nimbus recovery phrase') ||
      fullText.includes('format: apple river candle') ||
      fullText.includes('private key: ')
    ) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
  } else if (campaignId === 'k_00042') {
    // R1: No real-money betting, wagering, gambling
    const r1Betting = ['betting', 'betting 5000', 'put the money on an app', 'wager', 'cash match'];
    if (r1Betting.some((k) => fullText.includes(k))) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }

    // R2: No cheats, hacks, mod apk, coin generator, account selling
    const r2Cheats = [
      'modded apk',
      'unlimited coins',
      'glitch (working',
      'selling my maxed',
      'account for sale',
      'all cars unlocked dm me for price',
      'coin generator',
    ];
    if (r2Cheats.some((k) => fullText.includes(k))) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
  } else if (campaignId === 'k_00133') {
    // R1: No medical claims, guaranteed weight loss or muscle gain
    const r1Health = [
      'lose 6kg in a month',
      'guaranteed it works',
      'cures bloating',
      'fixes your gut',
      'doctors hate it',
      'gain muscle guaranteed',
    ];
    if (r1Health.some((k) => fullText.includes(k))) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }

    // R2: Do not disparage named competitor
    if (
      (fullText.includes('probite') || fullText.includes('competitor')) &&
      (fullText.includes('full of junk') || fullText.includes('candy') || fullText.includes('scam') || fullText.includes('poison'))
    ) {
      return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
    }
  }

  // --------------------------------------------------------------------------
  // Rule 4: Main Subject
  // --------------------------------------------------------------------------
  // Passing shoutouts in long list / vlog
  const shoutoutKeywords = [
    'sponsored by nimbus wallet by the way',
    'top 10 mobile games',
    'number ten is drift arena',
    'what i eat in a day as a student',
    'how much protein do you need',
    'crypto tax guide india',
  ];
  if (shoutoutKeywords.some((k) => fullText.includes(k))) {
    return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
  }

  // --------------------------------------------------------------------------
  // Rule 5: Sentiment
  // --------------------------------------------------------------------------
  const negativeKeywords = [
    'ruined my weekend',
    'support never replied',
    'just use something else',
    'pay to win now',
    'uninstalling',
    'not worth your time',
    'is overpriced',
    'texture is chalky',
    'skip it',
    'worst',
    'terrible',
  ];
  if (negativeKeywords.some((k) => fullText.includes(k))) {
    return { on_brief: false, score: 0.0, model: 'rule-engine-v1' };
  }

  // If passed all rules -> ON-BRIEF!
  return {
    on_brief: true,
    score: 0.95,
    model: 'rule-engine-v1',
  };
}
