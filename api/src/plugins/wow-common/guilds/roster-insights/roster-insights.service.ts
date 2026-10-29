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
import { RosterInsightsCache, insightsKey } from './roster-insights.cache';
import {
  emptyInsights,
  loadInsightRawRows,
  toInsightRow,
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
    const snapshotAt =
      audience === 'member' ? await this.loadSnapshotAt(guildId) : null;
    const all = await this.loadRows(adapter, guildId);
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
            lastSeen: { ...computeLastSeen(all), snapshotAt },
          }
        : {}),
      freshness: computeFreshness(rows),
    };
  }

  /** The guild's latest snapshot time — the export the presence rows are from. */
  private async loadSnapshotAt(guildId: number): Promise<string | null> {
    const [g] = await this.db
      .select({ at: schema.guilds.lastSnapshotAt })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .limit(1);
    return g?.at ? g.at.toISOString() : null;
  }

  /** Roster rows (one per member / community character) with their facts. */
  private async loadRows(
    adapter: HubKindAdapter | undefined,
    guildId: number,
  ): Promise<InsightRow[]> {
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
    // Rows past the resolver cap have no facts and are left out.
    return raw.flatMap((r) => {
      const resolved = facts.get(r.key);
      return resolved ? [toInsightRow(r, resolved)] : [];
    });
  }
}
