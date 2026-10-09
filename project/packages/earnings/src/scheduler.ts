import { dbWriter } from './dbWriter.js';
import { config } from './config.js';

export class Scheduler {
  private dirtyCampaigns = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  /**
   * Marks a campaign as dirty and schedules debounced recomputation.
   */
  public markDirty(campaignId: string): void {
    this.dirtyCampaigns.add(campaignId);

    if (!this.timer && !this.isProcessing) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushDirty();
      }, config.debounceMs);
    }
  }

  /**
   * Flushes and recalculates all currently marked dirty campaigns immediately.
   */
  public async flushDirty(): Promise<number> {
    if (this.dirtyCampaigns.size === 0) {
      return 0;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.isProcessing = true;
    const toProcess = Array.from(this.dirtyCampaigns);
    this.dirtyCampaigns.clear();

    let processedCount = 0;
    for (const campaignId of toProcess) {
      try {
        await dbWriter.recalculateCampaign(campaignId);
        processedCount++;
      } catch (err) {
        console.error(`[Scheduler] Error calculating spend for ${campaignId}:`, err);
        // Put back in dirty set for retry
        this.dirtyCampaigns.add(campaignId);
      }
    }

    this.isProcessing = false;

    // If new dirty campaigns accumulated while processing, schedule another run
    if (this.dirtyCampaigns.size > 0 && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushDirty();
      }, config.debounceMs);
    }

    return processedCount;
  }

  /**
   * Flushes specific campaigns immediately (e.g. at the end of a Kafka batch).
   */
  public async processCampaigns(campaignIds: string[]): Promise<void> {
    for (const id of campaignIds) {
      this.dirtyCampaigns.add(id);
    }
    await this.flushDirty();
  }

  public getPendingCount(): number {
    return this.dirtyCampaigns.size;
  }
}

export const scheduler = new Scheduler();
