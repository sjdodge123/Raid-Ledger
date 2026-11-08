/**
 * ROK-2133 (D5, L5): roster members' Armory snapshots (`guild_member_armory`)
 * as blizzard facts. The fact source uses them only for a ref whose character
 * produced no blizzard facts, so a linked character's own sync always wins.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { toForeverCandidates } from './blizzard-forever.candidates';
import { distinctIds, fanOut } from './fact-source.helpers';
import type {
  RosterCharRef,
  RosterKey,
  WowFactCandidates,
} from './wow-fact.types';

const { guildMemberArmory: a, guildMembers: m } = schema;
const byMember = (r: RosterCharRef): number | null => r.memberId;

/** True when `c` carries at least one fact. */
export function hasFacts(c: WowFactCandidates | undefined): boolean {
  return c !== undefined && Object.keys(c).length > 0;
}

/** The synced, still-verified snapshots of `ids`. */
function queryMemberRows(db: PostgresJsDatabase<typeof schema>, ids: number[]) {
  return db
    .select({
      memberId: a.guildMemberId,
      level: a.level,
      class: a.class,
      race: a.race,
      role: a.role,
      itemLevel: a.itemLevel,
      equipment: a.equipment,
      armoryProfessions: a.armoryProfessions,
      lastSyncedAt: a.syncedAt,
    })
    .from(a)
    .innerJoin(
      m,
      and(
        eq(m.id, a.guildMemberId),
        eq(m.blizzardCharacterId, a.blizzardCharacterId),
      ),
    )
    .where(and(inArray(a.guildMemberId, ids), isNotNull(a.syncedAt)));
}

/**
 * One query: the synced snapshots of the refs' members, still verified
 * against the member's current Blizzard id, as facts keyed by ref key.
 */
export async function loadMemberFacts(
  db: PostgresJsDatabase<typeof schema>,
  refs: RosterCharRef[],
): Promise<Map<RosterKey, WowFactCandidates>> {
  const ids = distinctIds(refs, byMember);
  if (ids.length === 0) return new Map();
  const rows = await queryMemberRows(db, ids);
  const byId = new Map(
    rows.map((r) => [
      r.memberId,
      toForeverCandidates({ ...r, id: String(r.memberId) }),
    ]),
  );
  return fanOut(refs, byMember, byId);
}
