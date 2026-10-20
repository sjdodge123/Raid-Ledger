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
import { executePlan, runErrorText } from './channel-lifecycle.run';
import { withReconcileLock, type LifecycleDb } from './channel-lifecycle.store';
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
    @Optional()
    @Inject(CHANNEL_LIFECYCLE_HUB_LINKER)
    hubLinker?: HubLinker,
  ) {
    this.hubLinker = hubLinker ?? NOOP_HUB_LINKER;
  }

  /**
   * Run one reconcile tick.
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
    const run = await withReconcileLock(this.db, () =>
      this.runLocked(guild, settings, opts),
    );
    if (!run.acquired) {
      throw new ConflictException('A reconcile is already running');
    }
    return run.value;
  }

  /** Plan + (unless dry) execute and record, under the lock. */
  private async runLocked(
    guild: Guild,
    settings: ChannelLifecycleSettingsDto,
    opts: ReconcileOptions,
  ): Promise<ReconcileResultDto> {
    const now = new Date();
    try {
      const categories = opts.dryRun
        ? {
            gamesId: settings.gamesCategoryId,
            archiveId: settings.archiveCategoryId,
          }
        : await this.resolveCategories(guild, settings);
      if (!categories) {
        return await this.record(
          now,
          emptyResult(false, 'no-archive-category'),
        );
      }
      const rows = await this.selectRows(guild, settings, opts, now);
      const plan = planReconcile(rows, settings);
      if (opts.dryRun) return plannedResult(plan);
      const ctx = await this.context(guild, settings, categories, now);
      return await this.record(now, await executePlan(ctx, plan));
    } catch (err) {
      return this.handleTickError(now, opts, err);
    }
  }

  /** The activity rows for this tick (scoped to the bot's guild). */
  private async selectRows(
    guild: Guild,
    settings: ChannelLifecycleSettingsDto,
    opts: ReconcileOptions,
    now: Date,
  ): Promise<GameLifecycleActivityRow[]> {
    const hubNeedsLinkGameIds =
      (await this.hubLinker.hubNeedsLinkGameIds?.()) ?? new Set<number>();
    return selectGameLifecycleActivity(this.db, {
      now,
      windowDays: settings.recentActivityDays,
      guildId: guild.id,
      hubNeedsLinkGameIds,
      ...(opts.gameIds ? { gameIds: opts.gameIds } : {}),
    });
  }

  /** The executor context for a live tick. */
  private async context(
    guild: Guild,
    settings: ChannelLifecycleSettingsDto,
    categories: ReconcileCategories,
    now: Date,
  ): Promise<ApplyContext> {
    const clientUrl = await this.settings.getClientUrl();
    const { db, bindings, hubLinker } = this;
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

  /** Persist found-or-created category ids when they changed (OQ-6). */
  private async persistCategories(
    settings: ChannelLifecycleSettingsDto,
    gamesId: string | null,
    archiveId: string,
  ): Promise<void> {
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

  /** A permission error before the loop stops the tick; anything else is recorded + rethrown. */
  private async handleTickError(
    now: Date,
    opts: ReconcileOptions,
    err: unknown,
  ): Promise<ReconcileResultDto> {
    if (err instanceof LifecyclePermissionError && !opts.dryRun) {
      Sentry.captureMessage('Channel lifecycle stopped: missing permissions', {
        level: 'warning',
        tags: { area: 'channel-lifecycle-permissions' },
      });
      return this.record(now, emptyResult(false, 'permissions'));
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
    const gamesId = games?.id ?? null;
    await this.persistCategories(settings, gamesId, archive.id);
    return { gamesId, archiveId: archive.id };
  }

  /** Write `lastRunAt` (+ error text, or clear it on a clean run). */
  private async record(
    now: Date,
    result: ReconcileResultDto,
  ): Promise<ReconcileResultDto> {
    const error = runErrorText(result);
    await this.settings.recordChannelLifecycleRun({ at: now, error });
    return result;
  }
}
