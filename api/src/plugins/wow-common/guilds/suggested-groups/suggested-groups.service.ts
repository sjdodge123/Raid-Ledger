import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  SuggestedGroupDto,
  SuggestedGroupsDto,
  SuggestedGroupsQuery,
} from '@raid-ledger/contract';
import { memorySwr, type MemoryCacheEntry } from '../../../../common/swr-cache';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import { SettingsService } from '../../../../settings/settings.service';
import { loadEventQuestSet } from '../../event-forever-progress.query';
import { WowFactsService } from '../../facts/wow-facts.service';
import { loadForeverQuestSources } from '../../forever-quest-source.query';
import { InstanceCatalogueService } from '../../instance-catalogue/instance-catalogue.service';
import { isPlannerHub } from '../dungeon-plan/dungeon-plan.helpers';
import {
  loadPlanHub,
  loadPlanSignups,
  type PlanHubRow,
} from '../dungeon-plan/dungeon-plan.query';
import { RosterInsightsCache } from '../roster-insights/roster-insights.cache';
import { levelOf } from '../roster-insights/roster-insights.levels';
import {
  joinFacts,
  loadGuildRows,
  type InsightRawRow,
} from '../roster-insights/roster-insights.refs';
import type { InsightRow } from '../roster-insights/roster-insights.types';
import { buildCandidates, eligiblePool } from './suggested-groups.helpers';
import {
  presentGroups,
  suggestedGroupsKey,
  SUGGESTED_GROUPS_TTL_MS,
  type ComputedGroups,
} from './suggested-groups.present';
import {
  applySharedQuests,
  claimedCharacterIds,
  scoredGroups,
} from './suggested-groups.quests';
import { rolesOf } from './suggested-groups.roles';

/** Bound on cached guilds (LRU). */
const MAX_CACHED_GUILDS = 500;

/**
 * ROK-2212 — `GET plugins/wow/guilds/:id/suggested-groups`: groups of 5
 * (1 tank / 1 healer / 3 dps, one character per player) from every known
 * roster character, per listed Forever dungeon whose level range they fit.
 * One computation per guild is cached 5 minutes, dropped on roster change (L10); scope, dungeon filter
 * and the visitor mask (L9) are applied per request, after grouping.
 */
@Injectable()
export class SuggestedGroupsService implements OnModuleInit {
  private readonly logger = new Logger(SuggestedGroupsService.name);
  private readonly cache = new Map<string, MemoryCacheEntry<ComputedGroups>>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly catalogue: InstanceCatalogueService,
    private readonly facts: WowFactsService,
    private readonly access: GuildAccessService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * L10: a roster import, claim or sync drops this guild's lineups with its
   * roster insights. The cache lives in the parent module (no import edge back).
   */
  onModuleInit(): void {
    this.moduleRef
      .get(RosterInsightsCache, { strict: false })
      .onGuildInvalidated((guildId) => this.invalidate(guildId));
  }

  /** Drop one guild's cached computation; the next read recomputes. */
  invalidate(guildId: number): void {
    this.cache.delete(suggestedGroupsKey(guildId));
  }

  /** The viewer's groups (the hub view guard already ran); 404 off a Forever guild hub. */
  async suggestedGroups(
    actor: GuildActor,
    guildId: number,
    query: SuggestedGroupsQuery,
  ): Promise<SuggestedGroupsDto> {
    const [computed, member] = await Promise.all([
      memorySwr({
        cache: this.cache,
        key: suggestedGroupsKey(guildId),
        ttlMs: SUGGESTED_GROUPS_TTL_MS,
        maxEntries: MAX_CACHED_GUILDS,
        fetcher: () => this.compute(guildId),
      }),
      this.access.canView(actor, guildId),
    ]);
    return presentGroups(computed, query, member ? 'member' : 'visitor');
  }

  /** Uncached: every listed dungeon's ranked lineups, unmasked. */
  async compute(guildId: number): Promise<ComputedGroups> {
    const [hub, raw] = await Promise.all([
      this.requireHub(guildId),
      loadGuildRows(this.db, guildId),
    ]);
    const pool = eligiblePool(
      await this.resolveRows(raw, guildId),
      levelOf,
      rolesOf,
    );
    const perDungeon = this.catalogue
      .list('wow_forever', 'dungeon') // listed rows only (`listInstances`)
      .map((d) =>
        buildCandidates(pool.entries, {
          id: d.id,
          name: d.name,
          minimumLevel: d.minimumLevel,
          maximumLevel: d.maximumLevel,
        }),
      )
      .filter((groups) => groups.length > 0);
    const ranked = await this.withSharedQuests(perDungeon, hub);
    return {
      groups: ranked.flat(),
      pool: pool.counts,
      generatedAt: new Date().toISOString(),
    };
  }

  /** L7: quest data for the scored groups' claimed members, one read each. */
  private async withSharedQuests(
    perDungeon: SuggestedGroupDto[][],
    hub: PlanHubRow,
  ): Promise<SuggestedGroupDto[][]> {
    if (perDungeon.length === 0) return [];
    const ids = claimedCharacterIds(scoredGroups(perDungeon));
    const instances = perDungeon.flatMap((gs) =>
      gs.slice(0, 1).map((g) => ({ id: g.instance.id })),
    );
    const [questSet, signups, snapshots] = await Promise.all([
      loadEventQuestSet({ db: this.db, settings: this.settings }, instances),
      loadPlanSignups(this.db, ids),
      loadForeverQuestSources(this.db, ids),
    ]);
    return applySharedQuests(perDungeon, {
      known: [...questSet.lookup.values()],
      guildFaction: hub.faction,
      signups: new Map(
        signups.flatMap((s) =>
          s.characterId === null ? [] : [[s.characterId, s]],
        ),
      ),
      snapshots,
    });
  }

  /** L1: a WoW: Forever `wow_guild` hub, else 404 (ROK-2214's predicate). */
  private async requireHub(guildId: number): Promise<PlanHubRow> {
    const hub = await loadPlanHub(this.db, guildId);
    if (!hub || !isPlannerHub(hub)) {
      throw new NotFoundException(
        'Suggested groups are for WoW: Forever guild hubs only',
      );
    }
    return hub;
  }

  /** Raw roster rows joined to their facts (claimed AND unclaimed, L2). */
  private async resolveRows(
    raw: readonly InsightRawRow[],
    guildId: number,
  ): Promise<InsightRow[]> {
    const refs = raw.map((r) => ({
      key: r.key,
      memberId: r.memberId,
      characterId: r.characterId,
    }));
    const { facts, truncated } = await this.facts.resolveFacts(refs);
    if (truncated) {
      this.logger.warn(
        `suggested-groups guild=${guildId} truncated at the resolver cap (${refs.length} rows)`,
      );
    }
    return joinFacts(raw, facts).rows;
  }
}
