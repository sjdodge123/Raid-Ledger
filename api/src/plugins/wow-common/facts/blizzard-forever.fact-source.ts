import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { armoryGear } from './blizzard-gear.helpers';
import { distinctIds, fact, fanOut, toRole } from './fact-source.helpers';
import type {
  RosterCharRef,
  RosterKey,
  WowFactCandidates,
  WowFactField,
  WowFactSource,
} from './wow-fact.types';

const { characters: c } = schema;
const byChar = (r: RosterCharRef): string | null => r.characterId;
const SRC = 'blizzard' as const;

/** The variant whose Armory rows this source serves. */
export const FOREVER_VARIANT = 'wow_forever';

interface ForeverArmoryRow {
  id: string;
  level: number | null;
  class: string | null;
  race: string | null;
  role: string | null;
  itemLevel: number | null;
  equipment: unknown;
  lastSyncedAt: Date | null;
}

/** Level/class/race/role/ilvl columns as blizzard facts. */
function profileFacts(row: ForeverArmoryRow, out: WowFactCandidates): void {
  const asOf = row.lastSyncedAt;
  if (row.level !== null) out.level = fact(row.level, SRC, asOf);
  if (row.class !== null) out.class = fact(row.class, SRC, asOf);
  if (row.race !== null) out.race = fact(row.race, SRC, asOf);
  const role = toRole(row.role);
  if (role) out.role = fact(role, SRC, asOf);
  if (row.itemLevel !== null) out.ilvl = fact(row.itemLevel, SRC, asOf);
}

/**
 * One Armory-synced Forever row as facts; asOf = `lastSyncedAt` (ROK-1920
 * ruling F2). `enchantsReported` is false (F5): the Forever equipment API has
 * not been seen reporting enchants, so a missing enchant reads as unknown.
 */
export function toForeverCandidates(row: ForeverArmoryRow): WowFactCandidates {
  const out: WowFactCandidates = {};
  profileFacts(row, out);
  const gear = armoryGear(row.equipment);
  if (gear) {
    out.gear = fact(gear, SRC, row.lastSyncedAt);
    out.enchantsReported = fact(false, SRC, row.lastSyncedAt);
  }
  return out;
}

/**
 * ROK-1920 — the Blizzard fact source for WoW: Forever. DB-backed (F1): it
 * reads what the Armory sync (nightly sync + manual refresh, ROK-1722)
 * persisted on Armory-linked Forever rows (F3: `game_variant='wow_forever'`,
 * `external_id` set, realm null, synced at least once) and never calls
 * Blizzard. Never answers professions (F11), quests or lockouts.
 */
@Injectable()
export class BlizzardForeverFactSource implements WowFactSource {
  private readonly logger = new Logger(BlizzardForeverFactSource.name);
  readonly id = SRC;
  readonly fields: readonly WowFactField[] = [
    'level',
    'class',
    'race',
    'role',
    'ilvl',
    'gear',
    'enchantsReported',
  ];

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** One query for the whole batch; a failed query yields no facts. */
  async load(
    refs: RosterCharRef[],
  ): Promise<Map<RosterKey, WowFactCandidates>> {
    const ids = distinctIds(refs, byChar);
    if (ids.length === 0) return new Map();
    try {
      const rows = await this.query(ids);
      const byId = new Map(rows.map((r) => [r.id, toForeverCandidates(r)]));
      return fanOut(refs, byChar, byId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Blizzard Forever facts unavailable: ${msg}`);
      return new Map();
    }
  }

  private query(ids: string[]): Promise<ForeverArmoryRow[]> {
    return this.db
      .select({
        id: c.id,
        level: c.level,
        class: c.class,
        race: c.race,
        role: c.role,
        itemLevel: c.itemLevel,
        equipment: c.equipment,
        lastSyncedAt: c.lastSyncedAt,
      })
      .from(c)
      .where(
        and(
          inArray(c.id, ids),
          eq(c.gameVariant, FOREVER_VARIANT),
          isNotNull(c.externalId),
          isNotNull(c.lastSyncedAt),
          isNull(c.realm),
        ),
      );
  }
}
