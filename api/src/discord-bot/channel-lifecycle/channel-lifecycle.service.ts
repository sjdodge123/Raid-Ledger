import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Guild } from 'discord.js';
import {
  LIFECYCLE_DEFAULTS,
  type ChannelLifecycleSettingsDto,
  type ReconcileResultDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { ensureCategory } from './channel-lifecycle.discord-ops';
import { LifecyclePermissionError } from './channel-lifecycle.errors';
import {
  emptyResult,
  planReconcile,
  plannedResult,
} from './channel-lifecycle.plan';
import {
  executePlan,
  PERMISSION_ERROR_TEXT,
  runErrorText,
} from './channel-lifecycle.run';
import {
  withReconcileLock,
  type LeaseRedis,
  type LifecycleDb,
  type LockedRun,
} from './channel-lifecycle.store';
import {
  CHANNEL_LIFECYCLE_HUB_LINKER,
  NOOP_HUB_LINKER,
  type ApplyContext,
  type HubLinker,
  type ReconcileCategories,
  type ReconcileOptions,
} from './channel-lifecycle.types';
import {
  selectGameLifecycleActivity,
  type GameLifecycleActivityRow,
} from './game-activity.queries';

/** One tick's inputs + what the locked section leaves for the post-tx writes. */
interface LockedTick {
  guild: Guild;
  settings: ChannelLifecycleSettingsDto;
  opts: ReconcileOptions;
  clientUrl: string;
  now: Date;
  /** Set by a live tick once resolved; persisted after the tx settles. */
  categories: ReconcileCategories | null;
}

/**
 * ROK-1431 — the channel-lifecycle reconciler (spec ROK-1428 §2.5): gates,
 * single-flight, plan, execute, record the run. The cron, the admin
 * "Reconcile now" route (L6) and the per-game nudge (L5b) all come through
 * `reconcile`.
 */
@Injectable()
export class ChannelLifecycleService {
  private readonly logger = new Logger(ChannelLifecycleService.name);
  private readonly hubLinker: HubLinker;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LifecycleDb,
    private readonly settings: SettingsService,
    private readonly client: DiscordBotClientService,
    private readonly bindings: ChannelBindingsService,
    @Inject(REDIS_CLIENT) private readonly redis: LeaseRedis,
    @Optional()
    @Inject(CHANNEL_LIFECYCLE_HUB_LINKER)
    hubLinker?: HubLinker,
  ) {
    this.hubLinker = hubLinker ?? NOOP_HUB_LINKER;
  }

  /**
   * Run one reconcile tick. The single-flight is a Redis lease that holds no
   * DB connection (Codex r4b P1); each game commits in its own transaction,
   * and every `SettingsService` call (the snapshot, the client URL, the
   * category ids, the run record) happens outside any of them (fix r4) — a
   * pooled query while a tx holds a connection deadlocks `DB_POOL_MAX=1`.
   *
   * @throws ConflictException when another reconcile holds the lock (→ 409)
   */
  async reconcile(opts: ReconcileOptions): Promise<ReconcileResultDto> {
    const settings = await this.settings.getChannelLifecycleSettings();
    if (!settings.enabled) return emptyResult(opts.dryRun, 'disabled');
    const guild = this.client.getGuild();
    if (!this.client.isConnected() || !guild) {
      return emptyResult(opts.dryRun, 'offline');
    }
    const clientUrl = await this.settings.getClientUrl();
    const tick: LockedTick = {
      guild,
      settings,
      opts,
      clientUrl,
      now: new Date(),
      categories: null,
    };
    const run = await this.runUnderLock(tick);
    if (!run.acquired) {
      throw new ConflictException('A reconcile is already running');
    }
    return this.record(tick.now, opts, run.value);
  }

  /** The leased section, then the category-id write; a failure is handled after it settles. */
  private async runUnderLock(
    tick: LockedTick,
  ): Promise<LockedRun<ReconcileResultDto>> {
    let run: LockedRun<ReconcileResultDto>;
    try {
      run = await withReconcileLock(this.redis, () =>
        this.runLocked(this.db, tick),
      );
    } catch (err) {
      await this.persistCategories(tick.settings, tick.categories);
      return { acquired: true, value: await this.handleTickError(tick, err) };
    }
    await this.persistCategories(tick.settings, tick.categories);
    return run;
  }

  /** Plan + (unless dry) execute, under the lease — one tx per game, no settings call. */
  private async runLocked(
    db: LifecycleDb,
    tick: LockedTick,
  ): Promise<ReconcileResultDto> {
    const { guild, settings, opts, now } = tick;
    const categories = opts.dryRun
      ? {
          gamesId: settings.gamesCategoryId,
          archiveId: settings.archiveCategoryId,
        }
      : await this.resolveCategories(guild, settings);
    if (!categories) return emptyResult(false, 'no-archive-category');
    if (!opts.dryRun) tick.categories = categories;
    const rows = await this.selectRows(db, guild, settings, opts, now);
    const plan = planReconcile(rows, settings);
    if (opts.dryRun) return plannedResult(plan);
    const result = await executePlan(this.context(db, tick, categories), plan);
    if (result.stoppedReason === 'permissions') {
      this.reportPermission(settings, opts);
    }
    return result;
  }

  /** The activity rows for this tick (scoped to the bot's guild). */
  private async selectRows(
    tx: LifecycleDb,
    guild: Guild,
    settings: ChannelLifecycleSettingsDto,
    opts: ReconcileOptions,
    now: Date,
  ): Promise<GameLifecycleActivityRow[]> {
    const hubNeedsLinkGameIds =
      (await this.hubLinker.hubNeedsLinkGameIds?.(tx)) ?? new Set<number>();
    return selectGameLifecycleActivity(tx, {
      now,
      windowDays: settings.recentActivityDays,
      guildId: guild.id,
      hubNeedsLinkGameIds,
      ...(opts.gameIds ? { gameIds: opts.gameIds } : {}),
    });
  }

  /** The executor context for a live tick. */
  private context(
    db: LifecycleDb,
    tick: LockedTick,
    categories: ReconcileCategories,
  ): ApplyContext {
    const { guild, settings, clientUrl, now } = tick;
    const { bindings, hubLinker } = this;
    return {
      guild,
      db,
      bindings,
      settings,
      categories,
      hubLinker,
      clientUrl,
      now,
    };
  }

  /** Persist found-or-created category ids when they changed (OQ-6) — after the tx. */
  private async persistCategories(
    settings: ChannelLifecycleSettingsDto,
    categories: ReconcileCategories | null,
  ): Promise<void> {
    if (!categories) return;
    const { gamesId, archiveId } = categories;
    if (
      gamesId === settings.gamesCategoryId &&
      archiveId === settings.archiveCategoryId
    )
      return;
    await this.settings.setChannelLifecycleSettings({
      gamesCategoryId: gamesId,
      archiveCategoryId: archiveId,
    });
  }

  /**
   * After the rollback: a permission error stops the tick (recorded by the
   * caller); anything else is recorded + rethrown.
   */
  private async handleTickError(
    tick: LockedTick,
    err: unknown,
  ): Promise<ReconcileResultDto> {
    const { now, settings, opts } = tick;
    if (err instanceof LifecyclePermissionError && !opts.dryRun) {
      this.reportPermission(settings, opts);
      return emptyResult(false, 'permissions');
    }
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Reconcile (${opts.trigger}) failed: ${message}`);
    if (!opts.dryRun)
      await this.settings.recordChannelLifecycleRun({
        at: now,
        error: message,
      });
    throw err;
  }

  /** D5/OQ-6: find-or-create Games + Archived; null when Archived cannot be resolved. */
  private async resolveCategories(
    guild: Guild,
    settings: ChannelLifecycleSettingsDto,
  ): Promise<ReconcileCategories | null> {
    const resolve = (id: string | null, name: string) =>
      ensureCategory(guild, { id, name, needsRoom: false }).catch(
        (err: unknown) => {
          if (err instanceof LifecyclePermissionError) throw err;
          return null;
        },
      );
    const games = await resolve(
      settings.gamesCategoryId,
      LIFECYCLE_DEFAULTS.gamesCategoryName,
    );
    const archive = await resolve(
      settings.archiveCategoryId,
      LIFECYCLE_DEFAULTS.archiveCategoryName,
    );
    if (!archive) return null;
    return { gamesId: games?.id ?? null, archiveId: archive.id };
  }

  /**
   * D14: ONE Sentry message per stopped tick. A nudge tick skips it while the
   * permission error is already recorded — the daily cron re-reports it, so a
   * guild-wide loss alerts once a day, not once per vote/event.
   */
  private reportPermission(
    settings: ChannelLifecycleSettingsDto,
    opts: ReconcileOptions,
  ): void {
    const known = settings.lastRunError === PERMISSION_ERROR_TEXT;
    if (opts.trigger === 'nudge' && known) return;
    Sentry.captureMessage('Channel lifecycle stopped: missing permissions', {
      level: 'warning',
      tags: { area: 'channel-lifecycle-permissions' },
    });
  }

  /**
   * Write `lastRunAt` (+ error text, or clear it on a clean run). A clean
   * nudge tick writes nothing: a single-game run must not clear a banner the
   * daily run recorded (only cron/manual ticks clear it). A dry run writes
   * nothing. Runs after the lock's tx has settled.
   */
  private async record(
    now: Date,
    opts: ReconcileOptions,
    result: ReconcileResultDto,
  ): Promise<ReconcileResultDto> {
    if (opts.dryRun) return result;
    const error = runErrorText(result);
    if (opts.trigger === 'nudge' && error === null) return result;
    await this.settings.recordChannelLifecycleRun({ at: now, error });
    return result;
  }
}
