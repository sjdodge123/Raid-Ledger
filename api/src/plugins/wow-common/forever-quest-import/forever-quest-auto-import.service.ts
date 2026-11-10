/**
 * ROK-2162: the Forever quest import runs on its own — no admin button needed.
 *
 * - **Empty overlay:** after boot, and whenever the Blizzard keys or the
 *   Forever config (the quest-import switch) are saved, a run starts when
 *   `wow_dungeon_quest_blizzard` has no rows. Fire-and-forget: boot never
 *   waits on it, and a failure is logged (the run itself reports to Sentry).
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
import { OnEvent } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ForeverQuestImportTrigger } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { SETTINGS_EVENTS } from '../../../settings/settings.types';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_CONFIG_UPDATED } from '../forever.settings';
import { isForeverQuestImportEnabled } from './forever-quest-import-switch';
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

@Injectable()
export class ForeverQuestAutoImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ForeverQuestAutoImportService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly registry: PluginRegistryService,
    private readonly importer: ForeverQuestImportService,
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
   * Start an `auto-empty` run when the overlay table has no rows.
   * @returns true when a run was started.
   */
  async startIfEmpty(): Promise<boolean> {
    if (!(await this.isOverlayEmpty())) return false;
    return this.tryStart('auto-empty');
  }

  /** The weekly job: start a `weekly` run and wait for it to finish. */
  async runWeekly(): Promise<void> {
    if (await this.tryStart('weekly')) await this.importer.currentRun;
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

  private kick(reason: string): void {
    if (!this.kicksEnabled) return;
    this.startIfEmpty().catch((err: unknown) => {
      this.logger.warn(
        `Forever quest auto-import check (${reason}) failed: ${String(err)}`,
      );
    });
  }
}
