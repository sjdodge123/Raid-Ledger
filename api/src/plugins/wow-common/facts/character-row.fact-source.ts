import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubFactSource } from '@raid-ledger/contract';
import { effectiveProfessions } from '../../../characters/characters-professions.helpers';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
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

interface CharRow {
  id: string;
  level: number | null;
  class: string | null;
  race: string | null;
  role: string | null;
  roleOverride: string | null;
  itemLevel: number | null;
  professions: unknown;
  armoryProfessions: unknown;
  lastSyncedAt: Date | null;
  externalId: string | null;
  addonGuid: string | null;
}

/**
 * Where the row's synced columns came from: Armory, addon, or hand entry.
 * An `external_id` row is Armory data → `blizzard`, which wins regardless of
 * age even while the Blizzard source is off (ROK-2138 OQ-1). That is only
 * correct while the addon import does not write class/level/race into an
 * Armory-linked row (ROK-2138 D7, the addon-import binding).
 */
function rowOrigin(row: CharRow): HubFactSource {
  if (row.externalId) return 'blizzard';
  return row.addonGuid ? 'addon' : 'manual';
}

/**
 * Professions per the ROK-2107 switch (ruling F0: Blizzard wins, the hand
 * entry is the fallback): the hand entry is `manual` (asOf unknown — a hand
 * edit has no capture time); the Armory copy is `blizzard`, asOf
 * lastSyncedAt, only on an Armory-synced row — `lastSyncedAt` set, which every
 * Armory sync path stamps (retail imports and a refreshed manual Forever row
 * never carry `externalId`). D6/F4: Armory professions still show while the
 * Blizzard source is off; when it is live `dropShadowedBlizzard` removes this copy.
 */
function professionsFact(row: CharRow, out: WowFactCandidates): void {
  const armory = row.lastSyncedAt ? row.armoryProfessions : null;
  const { value, source } = effectiveProfessions(row.professions, armory);
  if (!value || !source) return;
  const asOf = source === 'manual' ? null : row.lastSyncedAt;
  out.professions = fact(value, source, asOf);
}

/** The user-editable facts: roleOverride is `manual`, professions per switch. */
function editableFacts(row: CharRow, out: WowFactCandidates): void {
  const override = toRole(row.roleOverride);
  const synced = toRole(row.role);
  if (override) out.role = fact(override, 'manual', null);
  else if (synced) out.role = fact(synced, rowOrigin(row), row.lastSyncedAt);
  professionsFact(row, out);
}

/** One `characters` row as facts; asOf = lastSyncedAt. */
function toCandidates(row: CharRow): WowFactCandidates {
  const src = rowOrigin(row);
  const asOf = row.lastSyncedAt;
  const out: WowFactCandidates = {};
  if (row.level !== null) out.level = fact(row.level, src, asOf);
  if (row.class !== null) out.class = fact(row.class, src, asOf);
  if (row.race !== null) out.race = fact(row.race, src, asOf);
  if (row.itemLevel !== null) out.ilvl = fact(row.itemLevel, src, asOf);
  editableFacts(row, out);
  return out;
}

/**
 * ROK-1910 — facts from the linked `characters` rows: role/roleOverride,
 * professions (manual hand entry or the Armory copy, ROK-2107), level/class/race/ilvl.
 */
@Injectable()
export class CharacterRowFactSource implements WowFactSource {
  readonly id = 'manual' as const;
  readonly fields: readonly WowFactField[] = [
    'level',
    'class',
    'race',
    'role',
    'ilvl',
    'professions',
  ];

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** One query for the whole batch. */
  async load(
    refs: RosterCharRef[],
  ): Promise<Map<RosterKey, WowFactCandidates>> {
    const ids = distinctIds(refs, byChar);
    if (ids.length === 0) return new Map();
    const rows: CharRow[] = await this.db
      .select({
        id: c.id,
        level: c.level,
        class: c.class,
        race: c.race,
        role: c.role,
        roleOverride: c.roleOverride,
        itemLevel: c.itemLevel,
        professions: c.professions,
        armoryProfessions: c.armoryProfessions,
        lastSyncedAt: c.lastSyncedAt,
        externalId: c.externalId,
        addonGuid: c.addonGuid,
      })
      .from(c)
      .where(inArray(c.id, ids));
    const byId = new Map(rows.map((r) => [r.id, toCandidates(r)]));
    return fanOut(refs, byChar, byId);
  }
}
