import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('@andx/db', () => ({
  query: mockQuery,
}));

import { dbWriter } from '../src/dbWriter.js';

describe('Classifier - DbWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves evaluated clips using UNNEST bulk query', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const evaluations = [
      {
        clip_id: 'c_9000001',
        campaign_id: 'k_00007',
        result: { on_brief: true, score: 0.92, model: 'grok-4.7' },
      },
    ];

    const count = await dbWriter.saveEvaluations(evaluations);
    expect(count).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[0]).toContain('INSERT INTO classifier.clip_relevance');
    expect(callArgs[1][0]).toEqual(['c_9000001']);
    expect(callArgs[1][1]).toEqual(['k_00007']);
    expect(callArgs[1][2]).toEqual([true]);
    expect(callArgs[1][3]).toEqual([0.92]);
    expect(callArgs[1][4]).toEqual(['grok-4.7']);
  });

  it('returns 0 immediately if evaluations list is empty', async () => {
    const count = await dbWriter.saveEvaluations([]);
    expect(count).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
