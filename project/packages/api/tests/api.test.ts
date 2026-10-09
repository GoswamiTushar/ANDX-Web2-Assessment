import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockQuery, mockProducer } = vi.hoisted(() => {
  const query = vi.fn();
  const producer = {
    send: vi.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockQuery: query,
    mockProducer: producer,
  };
});

vi.mock('@andx/db', () => ({
  query: mockQuery,
  getPool: vi.fn(),
  closePool: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/kafka.js', () => ({
  getProducer: vi.fn().mockResolvedValue(mockProducer),
  disconnectKafka: vi.fn().mockResolvedValue(undefined),
}));

import { buildServer } from '../src/server.js';

describe('Public Query & Admin API Service', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Health check
  describe('GET /healthz', () => {
    it('returns 200 ok', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });

  // 2. Admin campaigns
  describe('POST /v1/admin/campaigns', () => {
    it('returns 400 for empty or non-array body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/campaigns',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid campaign item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/campaigns',
        payload: [{ campaign_id: 'k_00001' }], // missing fields
      });
      expect(res.statusCode).toBe(400);
    });

    it('bulk upserts campaigns and returns 200 with upserted count', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const payload = [
        {
          campaign_id: 'k_00001',
          brand: 'Nike',
          cpm_cents: 100,
          per_clip_cap_cents: 5000,
          budget_cents: 100000,
          start_at: '2026-08-01T00:00:00.000Z',
          end_at: '2026-08-10T00:00:00.000Z',
        },
      ];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/campaigns',
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ upserted: 1 });
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  // 3. System stats
  describe('GET /v1/stats', () => {
    it('returns distinct valid events, late dropped, and dlq counts', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { metric_name: 'distinct_valid_events', metric_value: '22111165' },
            { metric_name: 'late_dropped', metric_value: '90124' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { reason: 'invalid_schema', count: '11238' },
            { reason: 'unknown_campaign', count: '223949' },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/stats',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        distinct_valid_events: 22111165,
        late_dropped: 90124,
        dlq_pending: {
          invalid_schema: 11238,
          unknown_campaign: 223949,
        },
      });
    });
  });

  // 4. DLQ replay
  describe('POST /v1/dlq/replay', () => {
    it('returns 400 for invalid reason', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/dlq/replay',
        payload: { reason: 'bad_reason' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('publishes replay command and returns 202 with replayed count', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: '223949' }],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/dlq/replay',
        payload: { reason: 'unknown_campaign' },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ replayed: 223949 });
      expect(mockProducer.send).toHaveBeenCalledTimes(1);
    });
  });

  // 5. Campaign spend
  describe('GET /v1/campaigns/:id/spend', () => {
    it('returns 404 if campaign is unknown', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_unknown/spend',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Campaign not found' });
    });

    it('returns 200 with zeros if registered but earnings has not produced results yet', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              campaign_id: 'k_00001',
              budget_cents: '50000',
              cpm_cents: 100,
              per_clip_cap_cents: 500,
              end_at: '2026-08-10T00:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // earnings_spend not yet written

      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_00001/spend',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        campaign_id: 'k_00001',
        budget_cents: 50000,
        cpm_cents: 100,
        per_clip_cap_cents: 500,
        end_at: '2026-08-10T00:00:00.000Z',
        raw_earnings_cents: 0,
        spend_cents: 0,
        budget_exhausted: false,
        paid_clips: 0,
      });
    });

    it('returns computed spend from earnings schema', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ campaign_id: 'k_00001' }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              campaign_id: 'k_00001',
              budget_cents: '50000',
              cpm_cents: 100,
              per_clip_cap_cents: 500,
              end_at: '2026-08-10T00:00:00.000Z',
              raw_earnings_cents: '62000',
              spend_cents: '50000',
              budget_exhausted: true,
              paid_clips: 45,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_00001/spend',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        campaign_id: 'k_00001',
        budget_cents: 50000,
        cpm_cents: 100,
        per_clip_cap_cents: 500,
        end_at: '2026-08-10T00:00:00.000Z',
        raw_earnings_cents: 62000,
        spend_cents: 50000,
        budget_exhausted: true,
        paid_clips: 45,
      });
    });
  });

  // 6. Creator earnings
  describe('GET /v1/creators/:id/earnings', () => {
    it('returns 200 with total_cents: 0 and empty campaigns for unknown creator', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/creators/u_unknown/earnings',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        creator_id: 'u_unknown',
        total_cents: 0,
        campaigns: [],
      });
    });

    it('aggregates earnings by campaign correctly', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { campaign_id: 'k_00001', clips: 3, earned_cents: '331' },
          { campaign_id: 'k_00002', clips: 2, earned_cents: '4373' },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/creators/u_000001/earnings',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        creator_id: 'u_000001',
        total_cents: 4704,
        campaigns: [
          { campaign_id: 'k_00001', clips: 3, earned_cents: 331 },
          { campaign_id: 'k_00002', clips: 2, earned_cents: 4373 },
        ],
      });
    });
  });

  // 7. Top clips
  describe('GET /v1/campaigns/:id/top-clips', () => {
    it('returns 400 if from or to is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_00001/top-clips',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 if timestamps are not on whole hours', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_00001/top-clips?from=2026-01-08T03:15:00.000Z&to=2026-01-09T21:00:00.000Z',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 if window exceeds 168 hours', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_00001/top-clips?from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 if campaign does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_unknown/top-clips?from=2026-01-08T03:00:00.000Z&to=2026-01-09T21:00:00.000Z',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns top clips with next_cursor when more items exist', async () => {
      // 1. Campaign check
      mockQuery.mockResolvedValueOnce({ rows: [{ campaign_id: 'k_00001' }] });
      // 2. Lateral query with limit=1 (we fetch 2)
      mockQuery.mockResolvedValueOnce({
        rows: [
          { clip_id: 'c_0012093', creator_id: 'u_003303', gained: '184220' },
          { clip_id: 'c_0012094', creator_id: 'u_003304', gained: '150000' },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/campaigns/k_00001/top-clips?from=2026-01-08T03:00:00.000Z&to=2026-01-09T21:00:00.000Z&limit=1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.campaign_id).toBe('k_00001');
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toEqual({
        clip_id: 'c_0012093',
        creator_id: 'u_003303',
        views_gained: 184220,
      });
      expect(body.next_cursor).toBe('eyJnIjoxODQyMjAsImMiOiJjXzAwMTIwOTMifQ');
    });
  });

  // 8. Clip relevance
  describe('GET /v1/clips/:id/relevance', () => {
    it('returns 404 if not yet classified', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/clips/c_notyet/relevance',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with relevance classification data', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            clip_id: 'c_9000001',
            campaign_id: 'k_00007',
            on_brief: true,
            score: 0.91,
            model: 'test-model',
          },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/clips/c_9000001/relevance',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        clip_id: 'c_9000001',
        campaign_id: 'k_00007',
        on_brief: true,
        score: 0.91,
        model: 'test-model',
      });
    });
  });
});
