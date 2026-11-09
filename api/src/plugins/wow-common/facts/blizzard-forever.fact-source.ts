import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { distinctIds, fanOut } from './fact-source.helpers';
import {
  toForeverCandidates,
  type ForeverArmoryRow,
} from './blizzard-forever.candidates';
import { hasFacts, loadMemberFacts } from './blizzard-forever.member-facts';
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

/**
 * ROK-1920 — the Blizzard fact source for WoW: Forever. DB-backed (F1): it
 * reads what the Armory sync (nightly sync + manual refresh, ROK-1722)
 * persisted on Armory-linked Forever rows (F3: `game_variant='wow_forever'`,
 * `external_id` set, realm null, synced at least once) and never calls
 * Blizzard. Answers professions from `armory_professions` (ROK-2107,
 * superseding F11); never quests or lockouts.
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
    'professions',
  ];

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * One query for the characters, then (ROK-2133 D5) one for the member
   * snapshots of the refs whose character produced no blizzard facts. A
   * failed query yields no facts.
   */
  async load(
    refs: RosterCharRef[],
  ): Promise<Map<RosterKey, WowFactCandidates>> {
    try {
      const out = await this.characterFacts(refs);
      const pending = refs.filter((r) => !hasFacts(out.get(r.key)));
      const members = await loadMemberFacts(this.db, pending);
      for (const [key, facts] of members) out.set(key, facts);
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Blizzard Forever facts unavailable: ${msg}`);
      return new Map();
    }
  }

  private async characterFacts(
    refs: RosterCharRef[],
  ): Promise<Map<RosterKey, WowFactCandidates>> {
    const ids = distinctIds(refs, byChar);
    if (ids.length === 0) return new Map();
    const rows = await this.query(ids);
    const byId = new Map(rows.map((r) => [r.id, toForeverCandidates(r)]));
    return fanOut(refs, byChar, byId);
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
        armoryProfessions: c.armoryProfessions,
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
