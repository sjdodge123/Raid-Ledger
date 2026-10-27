import { createHash } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { SettingsService } from '../../../settings/settings.service';
import {
  STEAM_ACCOUNT_LINKED,
  STEAM_ACCOUNT_UNLINKED,
  type SteamAccountLinkEvent,
} from '../../../steam/steam.constants';
import {
  STEAM_APP_STATS_QUEUE,
  STEAM_STATS_JOB_RETRY,
  type SteamAppStatsJobData,
} from './steam-stats.constants';
import { SteamStatsStorageRepository } from './steam-stats-storage.repository';

/**
 * ROK-1953 D6 — a fresh Steam link refreshes that user's stats now instead
 * of leaving a 24 h empty card. The job id (user + a hash of the SteamID)
 * collapses repeat links of one account, yet a replacement account gets its
 * own job — an active fetch for the old one would otherwise swallow it and
 * drop its own result via `stillOwns` (Codex P2). It is
 * removed on completion so a later re-link enqueues again, and retries like
 * the nightly run so a 429 requeues. Unlink — also emitted FIRST when a
 * SteamID is replaced (`announceSteamLinkChange`) — purges the user's cached
 * stats + unlocks, so account A's data never outlives the switch to B (Codex
 * P2). Failures are logged (user id only — never the SteamID) and swallowed
 * so the link itself never fails.
 */
@Injectable()
export class SteamStatsLinkListener {
  private readonly logger = new Logger(SteamStatsLinkListener.name);

  constructor(
    private readonly settings: SettingsService,
    @InjectQueue(STEAM_APP_STATS_QUEUE) private readonly queue: Queue,
    private readonly storage: SteamStatsStorageRepository,
  ) {}

  /** Enqueue `{ trigger: 'link', userId }` when a Steam key is set. */
  @OnEvent(STEAM_ACCOUNT_LINKED)
  async handleLinked(e: SteamAccountLinkEvent): Promise<void> {
    try {
      if (!(await this.settings.isSteamConfigured())) return;
      const data: SteamAppStatsJobData = { trigger: 'link', userId: e.userId };
      await this.queue.add('link', data, {
        jobId: linkJobId(e),
        ...STEAM_STATS_JOB_RETRY,
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch (err: unknown) {
      this.warn('link refresh not queued', e.userId, err);
    }
  }

  /** Drop the old account's cached stats, Steam key or not. */
  @OnEvent(STEAM_ACCOUNT_UNLINKED)
  async handleUnlinked(e: SteamAccountLinkEvent): Promise<void> {
    try {
      await this.storage.purgeUser(e.userId);
    } catch (err: unknown) {
      this.warn('unlink purge failed', e.userId, err);
    }
  }

  private warn(what: string, userId: number, err: unknown): void {
    const reason = err instanceof Error ? err.name : 'unknown';
    this.logger.warn(`Steam stats ${what} for user ${userId} (${reason})`);
  }
}

/** `steam-stats-link-<userId>-<12 hex of sha256(SteamID)>` — no raw SteamID in Redis. */
function linkJobId(e: SteamAccountLinkEvent): string {
  const tag = createHash('sha256').update(e.steamId64).digest('hex');
  return `steam-stats-link-${e.userId}-${tag.slice(0, 12)}`;
}
