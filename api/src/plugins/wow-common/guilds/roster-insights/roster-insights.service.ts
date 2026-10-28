import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import { WowFactsService } from '../../facts/wow-facts.service';
import type { RosterCharRef } from '../../facts/wow-fact.types';
import { dedupeByMember, loadRosterRows } from '../guild-roster.helpers';
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
import type { InsightRow, InsightsAudience } from './roster-insights.types';

/**
 * ROK-1913 (H5) — `GET plugins/wow/guilds/:id/roster-insights`. One roster
 * query + one `WowFactsService` resolve (one batched query per source),
 * aggregated in TS and cached 5 minutes per guild + audience. Professions and
 * lockouts (ROK-1914) are members/staff only and OMITTED (not empty) for
 * visitors.
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
    const all = await this.loadRows(guildId);
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
            lastSeen: computeLastSeen(all),
          }
        : {}),
      freshness: computeFreshness(rows),
    };
  }

  /** Roster rows (one per member) joined to their resolved facts. */
  private async loadRows(guildId: number): Promise<InsightRow[]> {
    const raw = dedupeByMember(await loadRosterRows(this.db, guildId));
    const refs: RosterCharRef[] = raw.map((r) => ({
      key: `m${r.memberId}`,
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
      const resolved = facts.get(`m${r.memberId}`);
      if (!resolved) return [];
      return [
        {
          name: r.name,
          characterId: r.characterId,
          userId: r.userId,
          isMain: r.isMain ?? false,
          rankIndex: r.rankIndex,
          onlineAtExport: r.onlineAtExport,
          lastOnlineDays: r.lastOnlineDays,
          facts: resolved,
        },
      ];
    });
  }
}
