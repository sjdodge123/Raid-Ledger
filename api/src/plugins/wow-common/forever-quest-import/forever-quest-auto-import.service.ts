/**
 * ROK-2162: the Forever quest import runs on its own — no admin button needed.
 *
 * - **Empty overlay:** after boot, and whenever the Blizzard keys or the
 *   Forever config (the quest-import switch) are saved, a run starts when
 *   `wow_dungeon_quest_blizzard` has no rows. Fire-and-forget: boot never
 *   waits on it, and a failure is logged and sent to Sentry.
 *   It also starts when the last run did not succeed (a run that failed
 *   after writing some rows leaves the table non-empty), but not within
 *   `FOREVER_QUEST_AUTO_RETRY_FLOOR_MS` of a failed automatic run, so a
 *   crash loop or repeated saves do not hammer Blizzard. Manual runs are
 *   never throttled.
 * - **HTTP server only:** scripts that build the full `AppModule` with
 *   `createApplicationContext` (no HTTP adapter) never kick — a CLI exiting
 *   mid-run would leave a `running` marker behind.
 * - **Weekly:** the `forever-quest-import` job in `WowCronRegistrar`.
 *
 * Every trigger goes through `ForeverQuestImportService.start`, so the
 * one-run-at-a-time guard covers the button, the boot kick and the weekly
 * job alike; an overlapping trigger is skipped, not queued. A run only
 * upserts, so a failed run never removes rows an earlier run wrote.
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ForeverQuestImportReport,
  ForeverQuestImportTrigger,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { SETTINGS_EVENTS } from '../../../settings/settings.types';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_CONFIG_UPDATED } from '../forever.settings';
import {
  FOREVER_QUEST_IMPORT_OFF_MESSAGE,
  isForeverQuestImportEnabled,
} from './forever-quest-import-switch';
import {
  FOREVER_QUEST_IMPORT_INTERRUPTED_MESSAGE,
  FOREVER_QUEST_IMPORT_SENTRY_CONTEXT,
} from './forever-quest-import.report';
import { ForeverQuestImportService } from './forever-quest-import.service';

type Db = PostgresJsDatabase<typeof schema>;

/** The plugin that owns the import (its admin routes are gated on it). */
const BLIZZARD_PLUGIN_SLUG = 'blizzard';

/**
 * Whether boot and settings saves kick the empty-overlay check. `true` in the
 * app; the integration TestApp overrides it to `false` so no spec gets a run
 * it did not start (specs call `startIfEmpty` / `runWeekly` directly).
 */
export const FOREVER_QUEST_AUTO_IMPORT_KICKS = Symbol(
  'FOREVER_QUEST_AUTO_IMPORT_KICKS',
);

/** No automatic retry within this long of a failed automatic run. */
export const FOREVER_QUEST_AUTO_RETRY_FLOOR_MS = 60 * 60 * 1000;

/**
 * Error lines that end a run without Blizzard failing it: boot recovery
 * settling a run the process died in (review m4), and the kill switch's abort
 * (review m5). Neither arms the floor — the next kick may retry at once.
 */
const NON_BLIZZARD_FAILURE_MESSAGES: readonly string[] = [
  FOREVER_QUEST_IMPORT_INTERRUPTED_MESSAGE,
  FOREVER_QUEST_IMPORT_OFF_MESSAGE,
];

/**
 * The stored report is a failed automatic run (`auto-empty` / `weekly`) that
 * finished less than the floor ago. Persisted, so it holds across restarts.
 * A run settled by boot recovery or aborted by the switch does not count.
 */
export function isRecentAutoFailure(
  report: ForeverQuestImportReport,
  now: Date,
): boolean {
  if (report.status !== 'failed' || report.finishedAt === null) return false;
  if (report.trigger !== 'auto-empty' && report.trigger !== 'weekly') {
    return false;
  }
  if (report.errors.some((e) => NON_BLIZZARD_FAILURE_MESSAGES.includes(e))) {
    return false;
  }
  const age = now.getTime() - Date.parse(report.finishedAt);
  return age < FOREVER_QUEST_AUTO_RETRY_FLOOR_MS;
}

@Injectable()
export class ForeverQuestAutoImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ForeverQuestAutoImportService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly registry: PluginRegistryService,
    private readonly importer: ForeverQuestImportService,
    private readonly adapterHost: HttpAdapterHost,
    @Inject(FOREVER_QUEST_AUTO_IMPORT_KICKS)
    private readonly kicksEnabled: boolean,
  ) {}

  /** Boot: check in the background — never awaited, never blocks boot. */
  onApplicationBootstrap(): void {
    this.kick('boot');
  }

  /** Keys saved after boot: no restart needed for the first import. */
  @OnEvent(SETTINGS_EVENTS.BLIZZARD_UPDATED)
  handleBlizzardKeysSaved(): void {
    this.kick('Blizzard keys saved');
  }

  /** Forever config saved (the quest-import switch lives there). */
  @OnEvent(WOW_FOREVER_CONFIG_UPDATED)
  handleForeverConfigSaved(): void {
    this.kick('Forever config saved');
  }

  /**
   * Start an `auto-empty` run when the overlay table has no rows or the last
   * run failed — unless a failed automatic run finished within the floor.
   * @returns true when a run was started.
   */
  async startIfEmpty(now: Date = new Date()): Promise<boolean> {
    const last = await this.importer.getStatus();
    if (isRecentAutoFailure(last, now)) {
      this.logger.log(
        'Forever quest auto-import skipped: an automatic run failed within the last hour',
      );
      return false;
    }
    if (last.status !== 'failed' && !(await this.isOverlayEmpty())) {
      return false;
    }
    return this.tryStart('auto-empty');
  }

  /** The weekly job: start a `weekly` run and wait for it to finish. */
  async runWeekly(): Promise<void> {
    try {
      if (await this.tryStart('weekly')) await this.importer.currentRun;
    } catch (err: unknown) {
      reportToSentry(err, 'weekly');
      throw err;
    }
  }

  /**
   * Start a run when the plugin is active, the switch is on and the keys are
   * set; an overlapping run is skipped. @returns true when a run was started.
   */
  async tryStart(trigger: ForeverQuestImportTrigger): Promise<boolean> {
    if (!(await this.canRun())) return false;
    try {
      await this.importer.start(trigger);
      this.logger.log(`Forever quest import started (${trigger})`);
      return true;
    } catch (err: unknown) {
      // Busy / switched off / keys removed since canRun: skip, never queue.
      const skip =
        err instanceof ConflictException || err instanceof ForbiddenException;
      if (!skip) throw err;
      this.logger.log(
        `Forever quest import (${trigger}) skipped: ${err.message}`,
      );
      return false;
    }
  }

  private async canRun(): Promise<boolean> {
    if (!this.registry.isActive(BLIZZARD_PLUGIN_SLUG)) return false;
    if (!(await isForeverQuestImportEnabled(this.settings))) return false;
    return this.settings.isBlizzardConfigured();
  }

  private async isOverlayEmpty(): Promise<boolean> {
    const t = schema.wowDungeonQuestBlizzard;
    const rows = await this.db.select({ id: t.questId }).from(t).limit(1);
    return rows.length === 0;
  }

  /** True only in the HTTP server; `createApplicationContext` has no adapter. */
  private isHttpServer(): boolean {
    const adapter: unknown = this.adapterHost.httpAdapter;
    return adapter !== undefined && adapter !== null;
  }

  private kick(reason: string): void {
    if (!this.kicksEnabled || !this.isHttpServer()) return;
    this.startIfEmpty().catch((err: unknown) => {
      this.logger.warn(
        `Forever quest auto-import check (${reason}) failed: ${String(err)}`,
      );
      reportToSentry(err, reason);
    });
  }
}

/** A failure before a run starts (the run itself reports its own failures). */
function reportToSentry(err: unknown, reason: string): void {
  Sentry.captureException(err, {
    tags: { context: FOREVER_QUEST_IMPORT_SENTRY_CONTEXT },
    extra: { stage: 'auto-import check', reason },
  });
}
