import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import { HubKindRegistry } from '../../../../guilds/hub-kind.registry';
import type { HubKindAdapter } from '../../../plugin-host/extension-points';
import { WowFactsService } from '../../facts/wow-facts.service';
import type { RosterCharRef } from '../../facts/wow-fact.types';
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
import {
  emptyInsights,
  joinFacts,
  loadInsightRawRows,
  type JoinedRoster,
} from './roster-insights.refs';
import type { InsightsAudience } from './roster-insights.types';

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
export class RosterInsightsService {
  private readonly logger = new Logger(RosterInsightsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly facts: WowFactsService,
    private readonly access: GuildAccessService,
    private readonly cache: RosterInsightsCache,
    private readonly hubKinds: HubKindRegistry,
  ) {}

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

  /** Build the DTO for one guild + audience (uncached). */
  async compute(
    guildId: number,
    audience: InsightsAudience,
    onlyMains: boolean,
  ): Promise<WowRosterInsightsDto> {
    const adapter = await this.hubKinds.forGuild(guildId);
    // Q1 = A: never load a community roster for a non-member.
    if (audience === 'visitor' && adapter?.kind === 'game_community')
      return emptyInsights();
    // Snapshot time first: if an import lands between the two reads, the
    // footer shows presence as older than it is, never newer.
    const hub = audience === 'member' ? await this.loadHubRow(guildId) : null;
    const { rows: all, linkedUserIds } = await this.loadRows(adapter, guildId);
    const rows = onlyMains ? mainsOnly(all) : all;
    return {
      classes: computeClasses(rows),
      levels: computeLevels(rows),
      roles: computeRoles(rows),
      ...(audience === 'member'
        ? {
            professions: computeProfessions(rows),
            lockouts: computeLockouts(rows, Date.now()),
            lockoutReporters: countLockoutReporters(rows),
            // Presence is per character: the full roster, never mainsOnly (D4).
            lastSeen: { ...computeLastSeen(all), snapshotAt: hub?.at ?? null },
            // Linked mains of the full roster, never mainsOnly (ROK-1915 D2).
            gear: computeGear(all),
            ...(await this.raidSection(hub, linkedUserIds)),
          }
        : {}),
      freshness: computeFreshness(rows),
    };
  }

  /** ROK-1917 — `{ raidProgress }` for a WoW guild hub, else nothing. */
  private async raidSection(
    hub: RaidHubRow | null,
    linkedUserIds: readonly number[],
  ) {
    // Pulls are guild-level: the FULL roster's linked users report (D5, Q1).
    const raidProgress = await loadRaidProgress(this.db, hub, linkedUserIds);
    return raidProgress ? { raidProgress } : {};
  }

  /**
   * The hub row, read once per member request: its latest snapshot time (the
   * export the presence rows are from) and the ROK-1917 pull scope.
   */
  private async loadHubRow(
    guildId: number,
  ): Promise<(RaidHubRow & { at: string | null }) | null> {
    const g = schema.guilds;
    const [row] = await this.db
      .select({
        at: g.lastSnapshotAt,
        gameId: g.gameId,
        region: g.region,
        nameKey: g.nameKey,
        kind: g.kind,
      })
      .from(g)
      .where(eq(g.id, guildId))
      .limit(1);
    return row ? { ...row, at: row.at ? row.at.toISOString() : null } : null;
  }

  /** Roster rows (one per member / community character) with their facts. */
  private async loadRows(
    adapter: HubKindAdapter | undefined,
    guildId: number,
  ): Promise<JoinedRoster> {
    const raw = await loadInsightRawRows(this.db, adapter, guildId);
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
    return joinFacts(raw, facts);
  }
}
