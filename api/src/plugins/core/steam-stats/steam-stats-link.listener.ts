import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { SettingsService } from '../../../settings/settings.service';
import {
  STEAM_ACCOUNT_LINKED,
  type SteamAccountLinkEvent,
} from '../../../steam/steam.constants';
import {
  STEAM_APP_STATS_QUEUE,
  type SteamAppStatsJobData,
} from './steam-stats.constants';

/**
 * ROK-1953 D6 — a fresh Steam link refreshes that user's stats now instead
 * of leaving a 24 h empty card. The job id collapses repeat links; it is
 * removed on completion so a later re-link enqueues again. Failures are
 * logged (user id only — never the SteamID) and swallowed so the link itself
 * never fails. Unlink has no listener: rows stay, the read path shows the
 * user as `unlinked`.
 */
@Injectable()
export class SteamStatsLinkListener {
  private readonly logger = new Logger(SteamStatsLinkListener.name);

  constructor(
    private readonly settings: SettingsService,
    @InjectQueue(STEAM_APP_STATS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Enqueue `{ trigger: 'link', userId }` when a Steam key is set. */
  @OnEvent(STEAM_ACCOUNT_LINKED)
  async handleLinked(e: SteamAccountLinkEvent): Promise<void> {
    try {
      if (!(await this.settings.isSteamConfigured())) return;
      const data: SteamAppStatsJobData = { trigger: 'link', userId: e.userId };
      await this.queue.add('link', data, {
        jobId: `steam-stats-link-${e.userId}`,
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `Steam stats link refresh not queued for user ${e.userId} (${reason})`,
      );
    }
  }
}
