import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { query } from '@andx/db';
import type { TopClipsResponse, TopClipItem } from '@andx/contracts';

interface TopClipsParams {
  id: string;
}

interface TopClipsQuery {
  from?: string;
  to?: string;
  limit?: string;
  cursor?: string;
}

const ISO_WHOLE_HOUR_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00(\.000)?Z$/;

export const topClipsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get<{ Params: TopClipsParams; Querystring: TopClipsQuery }>(
    '/v1/campaigns/:id/top-clips',
    async (request, reply) => {
      const campaignId = request.params.id;
      const { from, to, limit: limitStr, cursor } = request.query;

      // 1. Validate timestamps presence and whole hour requirement
      if (!from || !to) {
        return reply.code(400).send({ error: "Missing required 'from' or 'to' query parameters" });
      }

      if (!ISO_WHOLE_HOUR_REGEX.test(from) || !ISO_WHOLE_HOUR_REGEX.test(to)) {
        return reply.code(400).send({
          error: "Timestamps must be ISO 8601 UTC on whole hours (e.g., 2026-01-01T12:00:00.000Z)",
        });
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);
      const fromMs = fromDate.getTime();
      const toMs = toDate.getTime();

      if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
        return reply.code(400).send({ error: 'Invalid timestamp dates' });
      }

      if (toMs <= fromMs) {
        return reply.code(400).send({ error: "'to' timestamp must be strictly greater than 'from'" });
      }

      const maxWindowMs = 168 * 3600 * 1000; // 168 hours
      if (toMs - fromMs > maxWindowMs) {
        return reply.code(400).send({ error: 'Time window exceeds 168 hours maximum' });
      }

      // 2. Validate limit (1 to 200, default 50)
      let limit = 50;
      if (limitStr !== undefined) {
        const parsedLimit = parseInt(limitStr, 10);
        if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
          return reply.code(400).send({ error: 'Limit must be an integer between 1 and 200' });
        }
        limit = parsedLimit;
      }

      // 3. Decode cursor if provided
      let cursorGained: bigint | null = null;
      let cursorClipId: string | null = null;

      if (cursor) {
        try {
          const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
          const parsed = JSON.parse(decoded);
          if (typeof parsed.g === 'number' && typeof parsed.c === 'string') {
            cursorGained = BigInt(parsed.g);
            cursorClipId = parsed.c;
          } else {
            return reply.code(400).send({ error: 'Malformed keyset cursor structure' });
          }
        } catch {
          return reply.code(400).send({ error: 'Invalid base64 cursor' });
        }
      }

      // 4. Verify campaign exists in api.campaigns
      const campCheck = await query<{ campaign_id: string }>(
        `SELECT campaign_id FROM api.campaigns WHERE campaign_id = $1`,
        [campaignId]
      );

      if (campCheck.rows.length === 0) {
        return reply.code(404).send({ error: 'Campaign not found' });
      }

      // 5. Execute high-performance LATERAL SQL query with keyset pagination
      // Fetch limit + 1 to detect whether a next page exists
      const fetchLimit = limit + 1;

      const sql = `
        SELECT c.clip_id, c.creator_id, (vt.views - COALESCE(vf.views, 0))::bigint AS gained
        FROM aggregator.clip_state c
        CROSS JOIN LATERAL (
          SELECT views FROM aggregator.snapshots s
          WHERE s.clip_id = c.clip_id AND s.observed_at < $2
          ORDER BY s.observed_at DESC LIMIT 1
        ) vt
        LEFT JOIN LATERAL (
          SELECT views FROM aggregator.snapshots s
          WHERE s.clip_id = c.clip_id AND s.observed_at < $3
          ORDER BY s.observed_at DESC LIMIT 1
        ) vf ON true
        WHERE c.campaign_id = $1
          AND (vt.views - COALESCE(vf.views, 0)) > 0
          AND (
            $4::bigint IS NULL OR
            (vt.views - COALESCE(vf.views, 0)) < $4::bigint OR
            ((vt.views - COALESCE(vf.views, 0)) = $4::bigint AND c.clip_id > $5::varchar)
          )
        ORDER BY gained DESC, c.clip_id ASC
        LIMIT $6;
      `;

      const res = await query<{
        clip_id: string;
        creator_id: string;
        gained: string;
      }>(sql, [
        campaignId,
        toDate.toISOString(),
        fromDate.toISOString(),
        cursorGained,
        cursorClipId,
        fetchLimit,
      ]);

      const hasNextPage = res.rows.length > limit;
      const resultRows = hasNextPage ? res.rows.slice(0, limit) : res.rows;

      const items: TopClipItem[] = resultRows.map((r) => ({
        clip_id: r.clip_id,
        creator_id: r.creator_id,
        views_gained: Number(r.gained),
      }));

      let nextCursor: string | null = null;
      if (hasNextPage && items.length > 0) {
        const lastItem = items[items.length - 1];
        const cursorPayload = {
          g: lastItem.views_gained,
          c: lastItem.clip_id,
        };
        nextCursor = Buffer.from(JSON.stringify(cursorPayload)).toString('base64url');
      }

      const response: TopClipsResponse = {
        campaign_id: campaignId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        items,
        next_cursor: nextCursor,
      };

      return reply.code(200).send(response);
    }
  );
};
