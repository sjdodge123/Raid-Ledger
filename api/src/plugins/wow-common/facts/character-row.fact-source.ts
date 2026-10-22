import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CharacterProfessionsSchema,
  type HubFactSource,
} from '@raid-ledger/contract';
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
  lastSyncedAt: Date | null;
  externalId: string | null;
  addonGuid: string | null;
}

/** Where the row's synced columns came from: Armory, addon, or hand entry. */
function rowOrigin(row: CharRow): HubFactSource {
  if (row.externalId) return 'blizzard';
  return row.addonGuid ? 'addon' : 'manual';
}

/** The user-editable facts: roleOverride and professions are `manual` (asOf
 * unknown — a hand edit has no capture time; lastSyncedAt is the Armory sync). */
function editableFacts(row: CharRow, out: WowFactCandidates): void {
  const override = toRole(row.roleOverride);
  const synced = toRole(row.role);
  if (override) out.role = fact(override, 'manual', null);
  else if (synced) out.role = fact(synced, rowOrigin(row), row.lastSyncedAt);
  const prof = CharacterProfessionsSchema.safeParse(row.professions);
  if (prof.success) out.professions = fact(prof.data, 'manual', null);
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
 * professions (manual on classic — no Armory endpoint), level/class/race/ilvl.
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
