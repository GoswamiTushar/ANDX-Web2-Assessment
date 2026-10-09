import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClassifyWithLlm } = vi.hoisted(() => ({
  mockClassifyWithLlm: vi.fn(),
}));

vi.mock('../src/llmClient.js', () => ({
  classifyWithLlm: mockClassifyWithLlm,
}));

import { config } from '../src/config.js';
import { ClassifierOrchestrator } from '../src/classifier.js';

describe('Classifier - Orchestrator', () => {
  let orchestrator: ClassifierOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    config.llmApiKey = 'test-mock-key';
    orchestrator = new ClassifierOrchestrator();
  });

  it('uses LLM result when LLM call succeeds', async () => {
    mockClassifyWithLlm.mockResolvedValueOnce({
      on_brief: true,
      score: 0.95,
      model: 'grok-4.7',
    });

    const res = await orchestrator.classify(
      'k_00007',
      'Nimbus wallet review',
      'good wallet'
    );

    expect(res.on_brief).toBe(true);
    expect(res.model).toBe('grok-4.7');
  });

  it('falls back to rule engine when LLM call fails or throws', async () => {
    mockClassifyWithLlm.mockRejectedValueOnce(new Error('Network timeout'));

    const res = await orchestrator.classify(
      'k_00007',
      'Setting up Nimbus Wallet in 60 seconds #crypto',
      'download nimbus wallet and write down 12 words'
    );

    expect(res.on_brief).toBe(true);
    expect(res.model).toBe('rule-engine-v1');
  });
});
