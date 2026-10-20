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
import { executePlan, PERMISSION_ERROR_TEXT } from './channel-lifecycle.run';
import { withReconcileLock, type LifecycleDb } from './channel-lifecycle.store';
import {
  CHANNEL_LIFECYCLE_HUB_LINKER,
  NOOP_HUB_LINKER,
  type HubLinker,
  type ReconcileCategories,
  type ReconcileOptions,
} from './channel-lifecycle.types';
import { selectGameLifecycleActivity } from './game-activity.queries';

/** `lastRunError` when no archive category can be found or created. */
export const NO_ARCHIVE_CATEGORY_TEXT =
  'Choose or allow an Archived category before enabling';

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
      const rows = await selectGameLifecycleActivity(this.db, {
        now,
        windowDays: settings.recentActivityDays,
        guildId: guild.id,
        ...(opts.gameIds ? { gameIds: opts.gameIds } : {}),
      });
      const plan = planReconcile(rows, settings);
      if (opts.dryRun) return plannedResult(plan);
      const clientUrl = await this.settings.getClientUrl();
      const ctx = {
        guild,
        db: this.db,
        bindings: this.bindings,
        settings,
        categories,
        hubLinker: this.hubLinker,
        clientUrl,
        now,
      };
      return await this.record(now, await executePlan(ctx, plan));
    } catch (err) {
      return this.handleTickError(now, opts, err);
    }
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
    if (
      gamesId !== settings.gamesCategoryId ||
      archive.id !== settings.archiveCategoryId
    ) {
      await this.settings.setChannelLifecycleSettings({
        gamesCategoryId: gamesId,
        archiveCategoryId: archive.id,
      });
    }
    return { gamesId, archiveId: archive.id };
  }

  /** Write `lastRunAt` (+ error text, or clear it on a clean run). */
  private async record(
    now: Date,
    result: ReconcileResultDto,
  ): Promise<ReconcileResultDto> {
    const error =
      result.stoppedReason === 'permissions'
        ? PERMISSION_ERROR_TEXT
        : result.stoppedReason === 'no-archive-category'
          ? NO_ARCHIVE_CATEGORY_TEXT
          : null;
    await this.settings.recordChannelLifecycleRun({ at: now, error });
    return result;
  }
}
