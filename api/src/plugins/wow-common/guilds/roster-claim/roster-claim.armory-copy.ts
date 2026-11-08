/**
 * ROK-2133 (D4, AC-9): the ROK-2128 claim copies the member's roster Armory
 * snapshot onto the character it just created — only a snapshot verified
 * against the member's CURRENT Blizzard id. Best-effort: the claim has
 * already committed, so a failure here is logged and never fails it.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import { applySnapshotToCharacter } from '../../forever-armory-snapshot/snapshot.apply';
import type { MemberArmorySnapshot } from '../../forever-armory-snapshot/snapshot.helpers';
import type { ClaimMember } from './roster-claim.tx';

type Db = PostgresJsDatabase<typeof schema>;
type CharacterRow = typeof schema.characters.$inferSelect;

/** The roster-member fields the copy keys on. */
export type CopyMember = Pick<ClaimMember, 'memberId' | 'blizzardCharacterId'>;

const a = schema.guildMemberArmory;

/** The member's stored snapshot (data columns only), or null when none. */
export async function loadMemberSnapshot(
  db: Db,
  memberId: number,
): Promise<MemberArmorySnapshot | null> {
  const [row] = await db
    .select({
      blizzardCharacterId: a.blizzardCharacterId,
      level: a.level,
      class: a.class,
      race: a.race,
      spec: a.spec,
      role: a.role,
      itemLevel: a.itemLevel,
      avatarUrl: a.avatarUrl,
      equipment: a.equipment,
      talents: a.talents,
      armoryProfessions: a.armoryProfessions,
      lastLoginAt: a.lastLoginAt,
      syncedAt: a.syncedAt,
    })
    .from(a)
    .where(eq(a.guildMemberId, memberId))
    .limit(1);
  return row ?? null;
}

/** Copy the verified snapshot; true when the character row was updated. */
async function copyVerified(
  db: Db,
  member: CopyMember,
  characterId: string,
): Promise<boolean> {
  if (member.blizzardCharacterId === null) return false;
  const snapshot = await loadMemberSnapshot(db, member.memberId);
  if (snapshot?.blizzardCharacterId !== member.blizzardCharacterId) {
    return false;
  }
  return applySnapshotToCharacter(db, characterId, snapshot);
}

/**
 * Copy the member's snapshot onto `row` and return the re-read row (or `row`
 * unchanged when nothing was copied). Never throws.
 */
export async function copyMemberArmory<R extends Pick<CharacterRow, 'id'>>(
  db: Db,
  member: CopyMember,
  row: R,
  logger: { warn(message: string): void },
): Promise<R | CharacterRow> {
  try {
    if (!(await copyVerified(db, member, row.id))) return row;
    const c = schema.characters;
    const [fresh] = await db.select().from(c).where(eq(c.id, row.id)).limit(1);
    return fresh ?? row;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Armory snapshot copy for roster claim ${row.id} skipped: ${reason}`,
    );
    return row;
  }
}
