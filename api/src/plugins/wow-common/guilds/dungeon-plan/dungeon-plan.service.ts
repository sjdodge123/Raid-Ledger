import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  DungeonPlanCharacterDto,
  DungeonPlanDto,
  DungeonPlanQuery,
} from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import { SettingsService } from '../../../../settings/settings.service';
import type { QuestOverlayDeps } from '../../dungeon-quests.overlay';
import { loadEventQuestSet } from '../../event-forever-progress.query';
import {
  buildQuestReadiness,
  type ReadinessSignup,
} from '../../event-quest-readiness.helpers';
import { WowFactsService } from '../../facts/wow-facts.service';
import { loadForeverQuestSources } from '../../forever-quest-source.query';
import type { FactionSide } from '../../quest-faction.helpers';
import { InstanceCatalogueService } from '../../instance-catalogue/instance-catalogue.service';
import type { CatalogueInstance } from '../../instance-catalogue/instance-catalogue.types';
import {
  loadGuildRows,
  type InsightRawRow,
} from '../roster-insights/roster-insights.refs';
import {
  filterQuestSetBySide,
  isPlannerHub,
  levelFit,
  pickRosterCharacters,
  resolvePlanSide,
} from './dungeon-plan.helpers';
import {
  loadPlanHub,
  loadPlanSignups,
  type PlanHubRow,
} from './dungeon-plan.query';

/** The kept characters' readiness rows, quest data and resolved levels. */
interface PlanCharacterData {
  signups: ReadinessSignup[];
  snapshots: Awaited<ReturnType<typeof loadForeverQuestSources>>;
  levels: Map<string, number | null>;
}

const EMPTY_CHARACTER_DATA: PlanCharacterData = {
  signups: [],
  snapshots: new Map(),
  levels: new Map(),
};

/**
 * ROK-2214 — `GET plugins/wow/guilds/:id/dungeon-plan`: one Forever dungeon's
 * level range, the requested claimed roster characters' levels, and the event
 * readiness matrix (`buildQuestReadiness`, with the plan side as its side override) on the dungeon's
 * quests filtered to the guild's side. Stateless; every read is DB-only.
 */
@Injectable()
export class DungeonPlanService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly catalogue: InstanceCatalogueService,
    private readonly facts: WowFactsService,
  ) {}

  /** The DB plus the quest-import switch the known-quest overlay reads. */
  private get questDeps(): QuestOverlayDeps {
    return { db: this.db, settings: this.settings };
  }

  /** The plan; 404 off a Forever guild hub, 400 for a non-dungeon id. */
  async plan(
    guildId: number,
    query: DungeonPlanQuery,
  ): Promise<DungeonPlanDto> {
    // Hub check and roster read together; a 404 hub rejects before any
    // roster data is used or returned.
    const [hub, rows] = await Promise.all([
      this.requireHub(guildId),
      loadGuildRows(this.db, guildId),
    ]);
    const instance = this.requireInstance(query.instanceId);
    const { kept, dropped } = pickRosterCharacters(rows, query.characterIds);
    const [questSet, data] = await Promise.all([
      loadEventQuestSet(this.questDeps, [{ id: instance.id }]),
      this.loadCharacterData(kept),
    ]);
    const { side, sideSource } = resolvePlanSide(hub.faction, data.signups);
    const { readiness, hidden } = planReadiness(questSet, side, data);
    return {
      instance: toInstanceDto(instance),
      side,
      sideSource,
      hiddenOtherFaction: hidden,
      characters: toCharacters(data.signups, data.levels, instance),
      droppedCharacterIds: dropped,
      readiness,
    };
  }

  /** L3: a WoW: Forever `wow_guild` hub, else 404. */
  private async requireHub(guildId: number): Promise<PlanHubRow> {
    const hub = await loadPlanHub(this.db, guildId);
    if (!hub || !isPlannerHub(hub)) {
      throw new NotFoundException(
        'Dungeon planner is for WoW: Forever guild hubs only',
      );
    }
    return hub;
  }

  /** L4: a listed WoW: Forever dungeon, else 400. */
  private requireInstance(instanceId: number): CatalogueInstance {
    const row = this.catalogue.get(instanceId, 'wow_forever');
    if (!row || row.category !== 'dungeon' || !row.listed) {
      throw new BadRequestException('Not a WoW: Forever dungeon');
    }
    return row;
  }

  /** Readiness rows, quest sources and levels; no reads with no characters. */
  private async loadCharacterData(
    kept: readonly InsightRawRow[],
  ): Promise<PlanCharacterData> {
    const ids = kept.flatMap((r) => r.characterId ?? []);
    if (ids.length === 0) return EMPTY_CHARACTER_DATA;
    const [signups, snapshots, levels] = await Promise.all([
      loadPlanSignups(this.db, ids),
      loadForeverQuestSources(this.db, ids),
      this.loadLevels(kept),
    ]);
    return { signups, snapshots, levels };
  }

  /** L8: the resolved level fact per kept character (the roster widgets' level). */
  private async loadLevels(
    kept: readonly InsightRawRow[],
  ): Promise<Map<string, number | null>> {
    const refs = kept.map((r) => ({
      key: r.key,
      memberId: r.memberId,
      characterId: r.characterId,
    }));
    const { facts } = await this.facts.resolveFacts(refs);
    const levels = new Map<string, number | null>();
    for (const r of kept) {
      if (r.characterId === null) continue;
      levels.set(r.characterId, facts.get(r.key)?.level?.value ?? null);
    }
    return levels;
  }
}

/**
 * L7 + readiness: the side-filtered quests and the matrix built on them. R3:
 * the builder filters by the plan's resolved side, never re-derives one from
 * the picked characters (a Horde alt must not hide an Alliance guild's quests).
 */
function planReadiness(
  questSet: Awaited<ReturnType<typeof loadEventQuestSet>>,
  side: FactionSide | null,
  data: PlanCharacterData,
): { readiness: DungeonPlanDto['readiness']; hidden: number } {
  const filtered = filterQuestSetBySide(questSet, side);
  const readiness = buildQuestReadiness(
    {
      quests: filtered.questSet,
      signups: data.signups,
      snapshots: data.snapshots,
      manual: [],
    },
    { side },
  );
  return { readiness, hidden: filtered.hidden };
}

function toInstanceDto(row: CatalogueInstance): DungeonPlanDto['instance'] {
  return {
    id: row.id,
    name: row.name,
    minimumLevel: row.minimumLevel,
    maximumLevel: row.maximumLevel,
  };
}

/** The kept characters in request order (`signups` keeps it), with level fit. */
function toCharacters(
  signups: readonly ReadinessSignup[],
  levels: ReadonlyMap<string, number | null>,
  instance: CatalogueInstance,
): DungeonPlanCharacterDto[] {
  return signups.flatMap((s) => {
    if (s.characterId === null) return [];
    const level = levels.get(s.characterId) ?? null;
    return [
      {
        characterId: s.characterId,
        name: (s.characterName ?? '').slice(0, 64),
        class: s.charClass === null ? null : s.charClass.slice(0, 50),
        level,
        levelFit: levelFit(level, instance.minimumLevel, instance.maximumLevel),
      },
    ];
  });
}
