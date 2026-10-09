import { query } from '@andx/db';
import type { ClassificationResult } from './llmClient.js';

export interface EvaluatedClip {
  clip_id: string;
  campaign_id: string;
  result: ClassificationResult;
}

export class DbWriter {
  public async saveEvaluations(evaluations: EvaluatedClip[]): Promise<number> {
    if (evaluations.length === 0) return 0;

    const clipIds: string[] = [];
    const campaignIds: string[] = [];
    const onBriefs: boolean[] = [];
    const scores: number[] = [];
    const models: string[] = [];

    for (const e of evaluations) {
      clipIds.push(e.clip_id);
      campaignIds.push(e.campaign_id);
      onBriefs.push(e.result.on_brief);
      scores.push(e.result.score);
      models.push(e.result.model);
    }

    const sql = `
      INSERT INTO classifier.clip_relevance (
        clip_id, campaign_id, on_brief, score, model, evaluated_at
      )
      SELECT u.clip_id, u.campaign_id, u.on_brief, u.score, u.model, NOW()
      FROM UNNEST(
        $1::varchar[],
        $2::varchar[],
        $3::boolean[],
        $4::real[],
        $5::varchar[]
      ) AS u(clip_id, campaign_id, on_brief, score, model)
      ON CONFLICT (clip_id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        on_brief = EXCLUDED.on_brief,
        score = EXCLUDED.score,
        model = EXCLUDED.model,
        evaluated_at = NOW();
    `;

    await query(sql, [clipIds, campaignIds, onBriefs, scores, models]);
    return evaluations.length;
  }
}

export const dbWriter = new DbWriter();
