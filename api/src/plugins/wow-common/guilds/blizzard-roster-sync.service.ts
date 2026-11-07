import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { BlizzardRosterStatus } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { findHubGuild } from '../../../guilds/guild-core.queries';
import { SettingsService } from '../../../settings/settings.service';
import { flagRosterChange } from '../addon-import/addon-import-guild.flag';
import { BlizzardService } from '../blizzard.service';
import type { ForeverGuildRoster } from '../blizzard-forever-guild.helpers';
import { isForeverArmoryImportEnabled } from '../forever-armory-switch';
import { isEmptyRoster } from './blizzard-roster-sync.helpers';
import {
  applyForeverRoster,
  type RosterApplyResult,
  type SyncGuild,
} from './blizzard-roster-sync.tx';
import { isForeverGuildHub } from './guild-slug.helpers';

/** One sync's outcome; `skipped`/`disabled` write nothing. */
export type RosterSyncResult =
  | { status: 'skipped' | 'disabled' | 'not_found' | 'skipped_empty' }
  | { status: 'ok'; updated: number; inserted: number; stale: boolean };

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1928 §B2 — `syncForeverGuildRoster(guildId)`: pull one WoW: Forever
 * guild's roster from the Blizzard guild roster API and apply it exactly
 * like an addon re-import (soft removal, one instant T, same lock, same
 * dings and mass-removal flag). A fetch/apply failure records status
 * `error`, reports to Sentry and is RETHROWN — the manual route maps it to
 * 502, the cron (part C) logs it and moves on.
 */
@Injectable()
export class BlizzardRosterSyncService {
  private readonly logger = new Logger(BlizzardRosterSyncService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly blizzard: BlizzardService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Sync one guild (steps 1–10).
   * @param guildId - `guilds.id`.
   * @returns `skipped` (not a Forever guild with a slug), `disabled` (kill
   *   switch off), `not_found`, `skipped_empty` or `ok`.
   * @throws whatever the fetch or apply threw, after recording `error`.
   */
  async syncForeverGuildRoster(guildId: number): Promise<RosterSyncResult> {
    const target = await this.loadTarget(guildId);
    if (target === null) return { status: 'skipped' };
    if (!(await isForeverArmoryImportEnabled(this.settings))) {
      return { status: 'disabled' };
    }
    try {
      return await this.fetchAndApply(target);
    } catch (err: unknown) {
      await this.recordFailure(target.guild, err);
      throw err;
    }
  }

  /** Step 1 — a Forever `wow_guild` with a Blizzard slug, else null. */
  private async loadTarget(
    guildId: number,
  ): Promise<{ guild: SyncGuild; slug: string } | null> {
    const hub = await findHubGuild(this.db, guildId);
    if (!hub || !isForeverGuildHub(hub.guild.kind, hub.gameSlug)) return null;
    const { id, gameId, region, nameKey, guildSlug } = hub.guild;
    if (guildSlug === null || guildSlug === '') return null;
    return { guild: { id, gameId, region, nameKey }, slug: guildSlug };
  }

  /** Step 3 (fetch OUTSIDE the transaction), then steps 4–10. */
  private async fetchAndApply(target: {
    guild: SyncGuild;
    slug: string;
  }): Promise<RosterSyncResult> {
    const { guild, slug } = target;
    const roster = await this.blizzard.fetchForeverGuildRoster(
      slug,
      guild.region,
    );
    const early = await this.earlyOutcome(guild.id, roster);
    if (early !== null || roster === null)
      return early ?? { status: 'not_found' };
    const now = new Date();
    const res = await this.db.transaction((tx) =>
      applyForeverRoster(tx, guild, roster.members, now),
    );
    await this.flagIfNeeded(res);
    return {
      status: 'ok',
      updated: res.updated,
      inserted: res.inserted,
      stale: res.stale,
    };
  }

  /** 404 → `not_found`; empty 200 → `skipped_empty` (B-4); roster untouched. */
  private async earlyOutcome(
    guildId: number,
    roster: ForeverGuildRoster | null,
  ): Promise<RosterSyncResult | null> {
    if (roster === null) {
      await this.writeStatus(guildId, 'not_found');
      return { status: 'not_found' };
    }
    if (!isEmptyRoster(roster)) return null;
    await this.writeStatus(guildId, 'skipped_empty');
    return { status: 'skipped_empty' };
  }

  /** Status only — `blizzard_roster_synced_at` moves on an applied sync. */
  private async writeStatus(
    guildId: number,
    status: BlizzardRosterStatus,
  ): Promise<void> {
    await this.db
      .update(schema.guilds)
      .set({ blizzardRosterStatus: status, updatedAt: new Date() })
      .where(eq(schema.guilds.id, guildId));
  }

  /** Status `error` + Sentry (tags only — never the token or the body). */
  private async recordFailure(guild: SyncGuild, err: unknown): Promise<void> {
    Sentry.captureException(err, {
      tags: { guildId: String(guild.id), region: guild.region },
    });
    const msg = err instanceof Error ? err.message : 'Unknown error';
    this.logger.warn(
      `Forever roster sync failed for guild ${guild.id}: ${msg}`,
    );
    try {
      await this.writeStatus(guild.id, 'error');
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : 'Unknown error';
      this.logger.warn(
        `Could not record roster sync error for ${guild.id}: ${m}`,
      );
    }
  }

  /** Post-commit staff flag for a wholesale change (never throws). */
  private async flagIfNeeded(res: RosterApplyResult): Promise<void> {
    for (const w of res.warnings) this.logger.warn(w);
    if (res.flag) await flagRosterChange(this.db, null, res.flag, this.logger);
  }
}
