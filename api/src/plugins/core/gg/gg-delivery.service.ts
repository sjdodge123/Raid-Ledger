/**
 * ROK-2187 — one GG <year> delivery pass: gate (kill switch + date/hour) →
 * compute every snapshot → announce exactly once (year-scoped dedup key,
 * released on a failed send) → after the DM offset, a paced DM wave of ≤25
 * `gg_ready` notifications per tick. `NotificationService.create` honours the
 * player's `gg_ready` prefs and falls back to in-app only without Discord (Q6).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmbedBuilder } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { NotificationDedupService } from '../../../notifications/notification-dedup.service';
import { NotificationService } from '../../../notifications/notification.service';
import {
  resolveDigestChannel,
  zonedParts,
} from '../../../notifications/weekly-digest-schedule.helpers';
import { GgComputeService } from './gg-compute.service';
import {
  GG_ANNOUNCE_TTL_SECONDS,
  ggAnnounceKey,
  isGgDeliveryDue,
  isGgDmWaveOpen,
} from './gg-delivery.schedule';
import {
  readGgDeliverySettings,
  type GgDeliverySettings,
} from './gg-delivery.settings';
import {
  findGgAnnouncedAt,
  runGgDmWave,
  type GgDmWaveResult,
} from './gg-dm-wave.helpers';

/** What one pass did. */
export type GgDeliveryOutcome =
  | { status: 'disabled' | 'not-due' | 'not-connected' | 'no-channel' }
  | { status: 'waiting-offset'; year: number; announcedAt: string }
  | {
      status: 'dm-wave';
      year: number;
      announcedAt: string;
      dm: GgDmWaveResult;
    };

type AnnounceResult =
  | { announcedAt: Date }
  | { status: 'not-connected' | 'no-channel' };

@Injectable()
export class GgDeliveryService {
  private readonly logger = new Logger(GgDeliveryService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly compute: GgComputeService,
    private readonly dedup: NotificationDedupService,
    private readonly bot: DiscordBotClientService,
    private readonly notifications: NotificationService,
  ) {}

  /** Current delivery settings (default date = this year in community tz). */
  async readSettings(now: Date = new Date()): Promise<GgDeliverySettings> {
    const tz = await this.compute.communityTimeZone();
    return readGgDeliverySettings(this.settings, zonedParts(now, tz).year);
  }

  /** The year the configured delivery date belongs to. */
  async deliveryYear(now: Date = new Date()): Promise<number> {
    return Number((await this.readSettings(now)).deliveryDate.slice(0, 4));
  }

  /** When `year` was announced, else null. */
  announcedAt(year: number): Promise<Date | null> {
    return findGgAnnouncedAt(this.db, ggAnnounceKey(year));
  }

  /**
   * One pass. `bypassDate` (admin send-now) skips only the date/hour gate —
   * the kill switch, the once-per-year announce and the DM offset still hold.
   */
  async runTick(
    now: Date,
    opts: { bypassDate?: boolean } = {},
  ): Promise<GgDeliveryOutcome> {
    const cfg = await this.readSettings(now);
    if (!cfg.enabled) return { status: 'disabled' };
    const tz = await this.compute.communityTimeZone();
    const due = isGgDeliveryDue(now, cfg.deliveryDate, cfg.deliveryHour, tz);
    if (!opts.bypassDate && !due) return { status: 'not-due' };
    const year = Number(cfg.deliveryDate.slice(0, 4));
    const announced = await this.ensureAnnounced(year, now, cfg.channelId);
    if ('status' in announced) return announced;
    const announcedAt = announced.announcedAt.toISOString();
    if (!isGgDmWaveOpen(now, announced.announcedAt, cfg.dmOffsetMinutes)) {
      return { status: 'waiting-offset', year, announcedAt };
    }
    const dm = await runGgDmWave(this.db, year, (claim) =>
      this.notifyReady(claim.userId, year),
    );
    return { status: 'dm-wave', year, announcedAt, dm };
  }

  /** Compute + post the announcement unless `year` already went out. */
  private async ensureAnnounced(
    year: number,
    now: Date,
    channelOverride: string | null,
  ): Promise<AnnounceResult> {
    const key = ggAnnounceKey(year);
    const existing = await findGgAnnouncedAt(this.db, key);
    if (existing) return { announcedAt: existing };
    if (!this.bot.isConnected()) return { status: 'not-connected' };
    const channelId = resolveDigestChannel(
      channelOverride,
      await this.settings.getDiscordBotDefaultChannel(),
    );
    if (!channelId) return { status: 'no-channel' };
    await this.compute.computeAll(year, now);
    const duplicate = await this.dedup.checkAndMarkSent(
      key,
      GG_ANNOUNCE_TTL_SECONDS,
    );
    if (!duplicate) await this.postAnnouncement(channelId, year, key);
    return { announcedAt: (await findGgAnnouncedAt(this.db, key)) ?? now };
  }

  private async postAnnouncement(
    channelId: string,
    year: number,
    key: string,
  ): Promise<void> {
    try {
      await this.bot.sendEmbed(channelId, await this.buildEmbed(year));
      this.logger.log(`GG ${year} announced in ${channelId}`);
    } catch (error) {
      await this.dedup
        .releaseKey(key)
        .catch((e: unknown) =>
          this.logger.error(
            `GG ${year}: releasing the announce claim failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      throw error;
    }
  }

  private async buildEmbed(year: number): Promise<EmbedBuilder> {
    const base = (await this.settings.getClientUrl())?.replace(/\/$/, '');
    const link = base ? `\n\nOpen yours: ${base}/gg/${year}` : '';
    return new EmbedBuilder()
      .setTitle(`GG ${year} is here`)
      .setDescription(
        `Everyone's year in games with the community is ready. Your own GG ${year} arrives in your DMs shortly.${link}`,
      );
  }

  /** The per-player `gg_ready` notification (prefs + no-Discord handled by create). */
  private async notifyReady(userId: number, year: number): Promise<void> {
    await this.notifications.create({
      userId,
      type: 'gg_ready',
      title: `Your GG ${year} is ready`,
      message: `Your year in games with the community — open your GG ${year}.`,
      payload: { year, url: `/gg/${year}` },
    });
  }
}
