import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { NotificationDedupService } from './notification-dedup.service';
import {
  assembleDigestSections,
  buildDigestSources,
} from './weekly-digest-data.helpers';
import { buildWeeklyDigestEmbed } from './weekly-digest-embed.helpers';
import {
  DIGEST_DEDUP_TTL_SECONDS,
  DIGEST_JOB_NAME,
  digestDedupKey,
  isDigestSlot,
  parseDigestSlot,
  resolveDigestChannel,
  safeTimeZone,
} from './weekly-digest-schedule.helpers';

/** Why a tick did or did not post — the fixture endpoint returns it. */
export type DigestOutcome =
  | { status: 'disabled' | 'off-slot' | 'not-connected' | 'no-channel' }
  | { status: 'empty' | 'duplicate'; channelId: string; dedupKey?: string }
  | {
      status: 'posted';
      channelId: string;
      dedupKey: string;
      messageId: string;
    };

/**
 * Posts the weekly community digest to a channel (ROK-1435 slice L4).
 *
 * Ticks hourly; posts only in the configured (day, hour) of the community
 * timezone, at most once per ISO week (dedup key), and only when there is
 * something to say. Off by default.
 */
@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
    private readonly discordBotClient: DiscordBotClientService,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron('0 5 * * * *', { name: DIGEST_JOB_NAME })
  async handleCron(): Promise<void> {
    // `false` = a no-op tick, so 23 of every 24 runs don't read as work done.
    await this.cronJobService.executeWithTracking(
      DIGEST_JOB_NAME,
      async () => (await this.runTick(new Date())).status === 'posted' || false,
    );
  }

  /** One hourly tick: the enabled + slot gates, then the post. */
  async runTick(now: Date): Promise<DigestOutcome> {
    const s = SETTING_KEYS;
    const enabled = await this.settingsService.get(s.WEEKLY_DIGEST_ENABLED);
    if (enabled !== 'true') return { status: 'disabled' };
    const [day, hour, timeZone] = await Promise.all([
      this.settingsService.get(s.WEEKLY_DIGEST_DAY),
      this.settingsService.get(s.WEEKLY_DIGEST_HOUR),
      this.getTimeZone(),
    ]);
    if (!isDigestSlot(now, parseDigestSlot(day, hour), timeZone)) {
      return { status: 'off-slot' };
    }
    return this.postDigest(now);
  }

  /**
   * Build and send this week's digest, bypassing the enabled + slot gates
   * (the tick has already checked them; the DEMO_MODE fixture skips them).
   * The dedup key is claimed only once there is a post to send, and given
   * back if the send fails so the next tick retries.
   */
  async postDigest(now: Date): Promise<DigestOutcome> {
    if (!this.discordBotClient.isConnected()) {
      this.logger.warn('Bot not connected — weekly digest deferred');
      return { status: 'not-connected' };
    }
    const channelId = await this.resolveChannel();
    if (!channelId) {
      this.logger.warn('No digest or default channel — weekly digest skipped');
      return { status: 'no-channel' };
    }
    const timeZone = await this.getTimeZone();
    const embed = await this.buildEmbed(now, timeZone);
    if (!embed) return { status: 'empty', channelId };
    const dedupKey = digestDedupKey(now, timeZone);
    const already = await this.dedupService.checkAndMarkSent(
      dedupKey,
      DIGEST_DEDUP_TTL_SECONDS,
    );
    if (already) return { status: 'duplicate', channelId, dedupKey };
    const messageId = await this.send(channelId, embed, dedupKey);
    return { status: 'posted', channelId, dedupKey, messageId };
  }

  /** Give back this week's claim — used by the DEMO_MODE fixture only. */
  async releaseWeek(now: Date): Promise<string> {
    const dedupKey = digestDedupKey(now, await this.getTimeZone());
    await this.dedupService.releaseKey(dedupKey);
    return dedupKey;
  }

  private async send(
    channelId: string,
    embed: NonNullable<ReturnType<typeof buildWeeklyDigestEmbed>>,
    dedupKey: string,
  ): Promise<string> {
    try {
      const message = await this.discordBotClient.sendEmbed(channelId, embed);
      this.logger.log(`Weekly digest ${dedupKey} posted to ${channelId}`);
      return message.id;
    } catch (error) {
      await this.dedupService.releaseKey(dedupKey);
      throw error;
    }
  }

  private async buildEmbed(now: Date, timeZone: string) {
    const sections = await assembleDigestSections(
      buildDigestSources(this.db, this.redis),
      (section, error) =>
        this.logger.warn(
          `Digest section ${section} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
    const [clientUrl, branding] = await Promise.all([
      this.settingsService.getTrustedClientUrl(),
      this.settingsService.getBranding().catch(() => null),
    ]);
    return buildWeeklyDigestEmbed({
      sections,
      clientUrl,
      communityName: branding?.communityName ?? null,
      windowEnd: now,
      timeZone,
    });
  }

  private async resolveChannel(): Promise<string | null> {
    const [dedicated, fallback] = await Promise.all([
      this.settingsService.get(SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID),
      this.settingsService.getDiscordBotDefaultChannel(),
    ]);
    return resolveDigestChannel(dedicated, fallback);
  }

  private async getTimeZone(): Promise<string> {
    return safeTimeZone(await this.settingsService.getDefaultTimezone());
  }
}
