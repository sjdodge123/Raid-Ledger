/**
 * ROK-2187 — one GG <year> delivery pass: gate (kill switch + date/hour) →
 * compute every snapshot → announce exactly once (year-scoped dedup key,
 * released on a failed send) → after the DM offset, a paced DM wave of ≤25
 * `gg_ready` notifications per tick. `NotificationService.create` honours the
 * player's `gg_ready` prefs and falls back to in-app only without Discord (Q6).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../../../discord-bot/embeds/embed-chrome.helpers';
import { NotificationDedupService } from '../../../notifications/notification-dedup.service';
import { NotificationService } from '../../../notifications/notification.service';
import { DiscordNotificationService } from '../../../notifications/discord-notification.service';
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
  | {
      status: 'disabled' | 'not-due' | 'not-connected' | 'no-channel' | 'busy';
    }
  | {
      status: 'waiting-offset' | 'announced';
      year: number;
      announcedAt: string;
    }
  | {
      status: 'dm-wave';
      year: number;
      announcedAt: string;
      dm: GgDmWaveResult;
    };

/** `runTick` options — see `runTick`. */
export interface GgTickOptions {
  /** Skip the date/hour gate (admin send-now, DEMO fixture). */
  bypassDate?: boolean;
  /** Stop after the announcement; the DM wave stays on the cron cadence. */
  announceOnly?: boolean;
}

/** One `computeAll` per year per window, even if the announce keeps failing. */
export const GG_COMPUTE_TTL_SECONDS = 6 * 60 * 60;

/** Dedup key guarding `year`'s pre-announce compute. */
export function ggComputeKey(year: number): string {
  return `gg:${year}:compute`;
}

type AnnounceResult =
  { announcedAt: Date } | { status: 'not-connected' | 'no-channel' };

@Injectable()
export class GgDeliveryService {
  private readonly logger = new Logger(GgDeliveryService.name);
  /** In-process guard: a slow pass never overlaps the next tick/send-now. */
  private running = false;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly compute: GgComputeService,
    private readonly dedup: NotificationDedupService,
    private readonly bot: DiscordBotClientService,
    private readonly notifications: NotificationService,
    private readonly discordDm: DiscordNotificationService,
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
   * One pass; `busy` while another pass is still running. `bypassDate` skips
   * only the date/hour gate — the kill switch, the once-per-year announce and
   * the DM offset still hold. `announceOnly` (send-now) never runs a DM wave,
   * so the ≤25-per-tick pacing holds however often an admin clicks.
   */
  async runTick(
    now: Date,
    opts: GgTickOptions = {},
  ): Promise<GgDeliveryOutcome> {
    if (this.running) return { status: 'busy' };
    this.running = true;
    try {
      return await this.runPass(now, opts);
    } finally {
      this.running = false;
    }
  }

  private async runPass(
    now: Date,
    opts: GgTickOptions,
  ): Promise<GgDeliveryOutcome> {
    const cfg = await this.readSettings(now);
    if (!cfg.enabled) return { status: 'disabled' };
    const year = Number(cfg.deliveryDate.slice(0, 4));
    if (!opts.bypassDate && !(await this.isStartedOrDue(now, cfg, year))) {
      return { status: 'not-due' };
    }
    const announced = await this.ensureAnnounced(year, now, cfg.channelId);
    if ('status' in announced) return announced;
    const announcedAt = announced.announcedAt.toISOString();
    if (!isGgDmWaveOpen(now, announced.announcedAt, cfg.dmOffsetMinutes)) {
      return { status: 'waiting-offset', year, announcedAt };
    }
    if (opts.announceOnly) return { status: 'announced', year, announcedAt };
    // Discord dispatch drops sends while the bot is down (it never queues
    // them), so a wave now would stamp dm_sent_at on DMs that never left.
    if (!this.bot.isConnected()) return { status: 'not-connected' };
    const dm = await runGgDmWave(this.db, year, (claim) =>
      this.notifyReady(claim.userId, year),
    );
    return { status: 'dm-wave', year, announcedAt, dm };
  }

  /**
   * The date/hour gate decides when `year` STARTS; once its announcement is
   * out (e.g. an early send-now) the wave continues on every tick.
   */
  private async isStartedOrDue(
    now: Date,
    cfg: GgDeliverySettings,
    year: number,
  ): Promise<boolean> {
    const tz = await this.compute.communityTimeZone();
    if (isGgDeliveryDue(now, cfg.deliveryDate, cfg.deliveryHour, tz)) {
      return true;
    }
    return (await findGgAnnouncedAt(this.db, ggAnnounceKey(year))) !== null;
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
    await this.computeOnce(year, now);
    const duplicate = await this.dedup.checkAndMarkSent(
      key,
      GG_ANNOUNCE_TTL_SECONDS,
    );
    if (!duplicate) await this.postAnnouncement(channelId, year, key);
    return { announcedAt: (await findGgAnnouncedAt(this.db, key)) ?? now };
  }

  /**
   * `computeAll` at most once per `GG_COMPUTE_TTL_SECONDS`: a failed announce
   * retries every tick without recomputing every player each time. A failed
   * compute gives the claim back.
   */
  private async computeOnce(year: number, now: Date): Promise<void> {
    const key = ggComputeKey(year);
    if (await this.dedup.checkAndMarkSent(key, GG_COMPUTE_TTL_SECONDS)) return;
    try {
      await this.compute.computeAll(year, now);
    } catch (error) {
      await this.dedup.releaseKey(key).catch(() => undefined);
      throw error;
    }
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

  /** The channel announcement, through the shared chrome (ROK-1477 AC4). */
  private async buildEmbed(year: number): Promise<ChannelEmbed> {
    const [clientUrl, branding] = await Promise.all([
      this.settings.getClientUrl(),
      this.settings.getBranding().catch(() => null),
    ]);
    const base = clientUrl?.replace(/\/$/, '');
    const link = base ? `\n\nOpen yours: ${base}/gg/${year}` : '';
    return createChannelEmbed({
      state: 'announcing',
      communityName: branding?.communityName ?? null,
    })
      .setTitle(`GG ${year} is here`)
      .setDescription(
        `Everyone's year in games with the community is ready. Your own GG ${year} arrives in your DMs shortly.${link}`,
      );
  }

  /**
   * The per-player `gg_ready` notification. `create` would hand the DM to
   * Discord fire-and-forget, so it runs with `skipDiscord` and the DM is
   * dispatched here and AWAITED: the promise settles once the durable BullMQ
   * job is added (retried by the queue). A disconnect or a failed enqueue
   * throws, which releases this row's claim instead of stamping `dm_sent_at`.
   * A `null` row means the player turned in-app gg_ready off — no DM either,
   * exactly as `create` behaves for every other caller.
   */
  private async notifyReady(userId: number, year: number): Promise<void> {
    if (!this.bot.isConnected()) {
      throw new Error('Discord bot not connected; GG DM left for a later tick');
    }
    const ready = {
      userId,
      type: 'gg_ready' as const,
      title: `Your GG ${year} is ready`,
      message: `Your year in games with the community — open your GG ${year}.`,
      payload: { year, url: `/gg/${year}` },
    };
    const row = await this.notifications.create({
      ...ready,
      skipDiscord: true,
    });
    if (!row) return;
    await this.discordDm.dispatch({ ...ready, notificationId: row.id });
  }
}
