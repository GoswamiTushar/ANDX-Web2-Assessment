import { config } from './config.js';
import { classifyWithLlm, type ClassificationResult } from './llmClient.js';
import { classifyWithRules } from './ruleEngine.js';

export class ClassifierOrchestrator {
  public async classify(
    campaignId: string,
    caption: string,
    transcript: string
  ): Promise<ClassificationResult> {
    // 1. Try LLM if configured
    if (config.llmApiKey) {
      try {
        const llmResult = await classifyWithLlm(campaignId, caption, transcript);
        if (llmResult) {
          return llmResult;
        }
      } catch (err) {
        console.warn('[Classifier] LLM call failed, falling back to rule engine:', err);
      }
    }

    // 2. Fallback to deterministic rule engine
    return classifyWithRules(campaignId, caption, transcript);
  }
}

export const classifierOrchestrator = new ClassifierOrchestrator();
