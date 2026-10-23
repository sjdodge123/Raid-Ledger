import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AddonCharSnapshotData } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  averageIlvl,
  distinctIds,
  fact,
  fanOut,
  talentRoleHint,
} from './fact-source.helpers';
import type {
  RosterCharRef,
  RosterKey,
  WowFactCandidates,
  WowFactField,
  WowFactSource,
} from './wow-fact.types';

const { characterAddonSnapshots: snap, characters: c } = schema;
const byChar = (r: RosterCharRef): string | null => r.characterId;

interface SnapshotRow {
  characterId: string;
  data: AddonCharSnapshotData;
  capturedAt: Date;
  class: string | null;
}

/** One LedgerLink `char` snapshot as facts; asOf = its capture time. */
function toCandidates(row: SnapshotRow): WowFactCandidates {
  const { data, capturedAt: asOf } = row;
  const out: WowFactCandidates = {
    lockouts: fact(data.lockouts, 'addon', asOf),
  };
  if (data.gear.length > 0) out.gear = fact(data.gear, 'addon', asOf);
  const ilvl = averageIlvl(data.gear);
  if (ilvl !== null) out.ilvl = fact(ilvl, 'addon', asOf);
  if (data.quests) out.quests = fact(data.quests, 'addon', asOf);
  const role = talentRoleHint(row.class, data.talents);
  if (role) out.role = fact(role, 'addon', asOf);
  return out;
}

/**
 * ROK-1910 — facts from the linked characters' LedgerLink `char` snapshots:
 * gear (with enchants), ilvl, quests, lockouts and a talents role hint.
 */
@Injectable()
export class AddonSnapshotFactSource implements WowFactSource {
  readonly id = 'addon' as const;
  readonly fields: readonly WowFactField[] = [
    'gear',
    'ilvl',
    'quests',
    'lockouts',
    'role',
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
    const rows: SnapshotRow[] = await this.db
      .select({
        characterId: snap.characterId,
        data: snap.data,
        capturedAt: snap.capturedAt,
        class: c.class,
      })
      .from(snap)
      .innerJoin(c, eq(c.id, snap.characterId))
      .where(and(inArray(snap.characterId, ids), eq(snap.section, 'char')));
    const byId = new Map(rows.map((r) => [r.characterId, toCandidates(r)]));
    return fanOut(refs, byChar, byId);
  }
}
