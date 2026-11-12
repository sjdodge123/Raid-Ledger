import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  WowRosterInsightsDto,
  WowRosterRaidProgressDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import { HubKindRegistry } from '../../../../guilds/hub-kind.registry';
import { WowFactsService } from '../../facts/wow-facts.service';
import type { RosterCharRef } from '../../facts/wow-fact.types';
import {
  loadInsightsHubRow,
  type InsightsHubRow,
} from './roster-insights.hub-row';
import {
  computeFreshness,
  computeProfessions,
  computeRoles,
  mainsOnly,
} from './roster-insights.helpers';
import { computeClasses, computeLevels } from './roster-insights.levels';
import {
  computeLockouts,
  countLockoutReporters,
} from './roster-insights.lockouts';
import { computeLastSeen } from './roster-insights.last-seen';
import { computeGear } from './roster-insights.gear';
import {
  loadRaidProgress,
  type RaidHubRow,
} from './roster-insights.raid-progress';
import { RosterInsightsCache, insightsKey } from './roster-insights.cache';
import { attunementsApply } from './roster-insights.attunements';
import { loadAttunements } from './roster-insights.attunements.query';
import {
  emptyInsights,
  joinFacts,
  linkedOwners,
  loadGuildRows,
  loadInsightRawRows,
  type InsightRawRow,
} from './roster-insights.refs';
import type { InsightRow, InsightsAudience } from './roster-insights.types';

/**
 * ROK-1913 (H5) — `GET plugins/wow/guilds/:id/roster-insights`. One roster
 * query + one `WowFactsService` resolve (one batched query per source),
 * aggregated in TS and cached 5 minutes per guild + audience. Professions and
 * lockouts (ROK-1914) are members/staff only and OMITTED (not empty) for
 * visitors. ROK-1925: the roster comes from the hub kind (guild roster or
 * community members' Forever characters); a community VISITOR gets
 * `emptyInsights()` (Q1 = A) — community membership is RL-private.
 */
@Injectable()
export class RosterInsightsService implements OnModuleInit {
  private readonly logger = new Logger(RosterInsightsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly facts: WowFactsService,
    private readonly access: GuildAccessService,
    private readonly cache: RosterInsightsCache,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  /** ROK-2178 (R2): let the cache re-warm the keys an import drops. */
  onModuleInit(): void {
    this.cache.registerRecompute((guildId, audience, onlyMains) =>
      this.compute(guildId, audience, onlyMains),
    );
  }

  /** The viewer's insights (the hub view guard already ran). */
  async insights(
    actor: GuildActor,
    guildId: number,
    onlyMains: boolean,
  ): Promise<WowRosterInsightsDto> {
    const audience: InsightsAudience = (await this.access.canView(
      actor,
      guildId,
    ))
      ? 'member'
      : 'visitor';
    return this.cache.get(insightsKey(guildId, audience, onlyMains), () =>
      this.compute(guildId, audience, onlyMains),
    );
  }

  /**
   * Build the DTO for one guild + audience (uncached). ROK-2178: the reads run
   * in as few sequential round trips as their inputs allow — hub row ∥ guild
   * roster, then facts ∥ raid pulls. R2: also the cache's background warm.
   */
  async compute(
    guildId: number,
    audience: InsightsAudience,
    onlyMains: boolean,
  ): Promise<WowRosterInsightsDto> {
    const { hub, raw } = await this.loadRoster(guildId, audience);
    if (!raw) return emptyInsights();
    // Pulls need only the hub row and the raw roster's owners (full roster,
    // never mainsOnly — D5, Q1): issue them before the facts resolve.
    const raid =
      audience === 'member'
        ? handled(this.raidSection(hub, linkedOwners(raw)))
        : null;
    const all = await this.resolveRows(raw, guildId);
    const rows = onlyMains ? mainsOnly(all) : all;
    return {
      classes: computeClasses(rows),
      levels: computeLevels(rows),
      roles: computeRoles(rows),
      ...(raid ? await this.memberSection(hub, rows, all, raid) : {}),
      freshness: computeFreshness(rows),
    };
  }

  /**
   * The hub row and the raw roster; `raw` null = a community VISITOR (Q1 = A).
   * Snapshot time first: the hub row is ISSUED before the roster read, so if
   * an import lands between them the footer shows presence as older than it
   * is, never newer. The guild roster is issued speculatively alongside it
   * (the kind is only known once the hub row lands) and dropped for any other
   * kind; a community roster still waits for the kind, so it never loads for
   * a visitor.
   */
  private async loadRoster(
    guildId: number,
    audience: InsightsAudience,
  ): Promise<{ hub: InsightsHubRow | null; raw: InsightRawRow[] | null }> {
    const hubRead = loadInsightsHubRow(this.db, guildId);
    const guildRead = handled(loadGuildRows(this.db, guildId));
    const hub = await hubRead;
    const adapter = hub ? this.hubKinds.resolve(hub.kind) : undefined;
    if (audience === 'visitor' && adapter?.kind === 'game_community')
      return { hub, raw: null };
    const raw =
      adapter?.kind === 'wow_guild'
        ? await guildRead
        : await loadInsightRawRows(this.db, adapter, guildId);
    return { hub, raw };
  }

  /** The members/staff-only keys (in their original order). */
  private async memberSection(
    hub: InsightsHubRow | null,
    rows: readonly InsightRow[],
    all: readonly InsightRow[],
    raid: Promise<{ raidProgress?: WowRosterRaidProgressDto }>,
  ) {
    const [raidKeys, attunementKeys] = await Promise.all([
      raid,
      // ROK-1927: mains of the full roster (ruling D), never a visitor.
      this.attunementSection(hub, all),
    ]);
    return {
      professions: computeProfessions(rows),
      lockouts: computeLockouts(rows, Date.now()),
      lockoutReporters: countLockoutReporters(rows),
      // Presence is per character: the full roster, never mainsOnly (D4).
      lastSeen: { ...computeLastSeen(all), snapshotAt: hub?.at ?? null },
      // Linked mains of the full roster, never mainsOnly (ROK-1915 D2).
      gear: computeGear(all),
      ...raidKeys,
      ...attunementKeys,
    };
  }

  /** ROK-1927 — `{ attunements }` for a Forever guild hub, else nothing. */
  private async attunementSection(
    hub: { kind: string; gameSlug: string | null } | null,
    all: readonly InsightRow[],
  ) {
    if (!attunementsApply(hub)) return {};
    return { attunements: await loadAttunements(this.db, all) };
  }

  /** ROK-1917 — `{ raidProgress }` for a WoW guild hub, else nothing. */
  private async raidSection(
    hub: RaidHubRow | null,
    linkedUserIds: readonly number[],
  ): Promise<{ raidProgress?: WowRosterRaidProgressDto }> {
    // Pulls are guild-level: the FULL roster's linked users report (D5, Q1).
    const raidProgress = await loadRaidProgress(this.db, hub, linkedUserIds);
    return raidProgress ? { raidProgress } : {};
  }

  /** Raw roster rows joined to their facts (rows past the cap drop). */
  private async resolveRows(
    raw: readonly InsightRawRow[],
    guildId: number,
  ): Promise<InsightRow[]> {
    const refs: RosterCharRef[] = raw.map((r) => ({
      key: r.key,
      memberId: r.memberId,
      characterId: r.characterId,
    }));
    const { facts, truncated } = await this.facts.resolveFacts(refs);
    if (truncated) {
      // TODO(ROK-1905 follow-up): WowRosterInsightsSchema has no `truncated`
      // field — add one in the contract so widgets can say "first 2000".
      this.logger.warn(
        `roster-insights guild=${guildId} truncated at the resolver cap (${refs.length} rows)`,
      );
    }
    return joinFacts(raw, facts).rows;
  }
}

/**
 * Mark a promise as handled now, so a read that is awaited later (or dropped)
 * never surfaces as an unhandled rejection; awaiting it still throws.
 */
function handled<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined);
  return p;
}
