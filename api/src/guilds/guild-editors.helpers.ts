import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateGuildEditorInput,
  GuildEditor,
  GuildEditorKind,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/** ROK-1785 — `guild_editors` reads/writes (access is checked by the caller). */

type Db = PostgresJsDatabase<typeof schema>;

const { guildMembers, guildEditors: ge, users } = schema;

interface RawEditorRow {
  id: number;
  guildId: number;
  kind: string;
  rankIndex: number | null;
  guildMemberId: number | null;
  memberName: string | null;
  grantedBy: string | null;
  createdAt: Date;
}

function toKind(kind: string): GuildEditorKind {
  return kind === 'member' ? 'member' : 'rank';
}

/** Raw row + rank-name lookup → contract `GuildEditor`. */
export function toGuildEditor(
  row: RawEditorRow,
  rankNames: Map<number, string | null>,
): GuildEditor {
  return {
    id: row.id,
    guildId: row.guildId,
    kind: toKind(row.kind),
    rankIndex: row.rankIndex,
    rankName:
      row.rankIndex === null ? null : (rankNames.get(row.rankIndex) ?? null),
    guildMemberId: row.guildMemberId,
    memberName: row.memberName,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadEditorRows(
  db: Db,
  guildId: number,
): Promise<RawEditorRow[]> {
  return db
    .select({
      id: ge.id,
      guildId: ge.guildId,
      kind: ge.kind,
      rankIndex: ge.rankIndex,
      guildMemberId: ge.guildMemberId,
      memberName: guildMembers.characterName,
      grantedBy: users.username,
      createdAt: ge.createdAt,
    })
    .from(ge)
    .leftJoin(guildMembers, eq(guildMembers.id, ge.guildMemberId))
    .leftJoin(users, eq(users.id, ge.grantedBy))
    .where(eq(ge.guildId, guildId))
    .orderBy(asc(ge.kind), asc(ge.rankIndex), asc(guildMembers.characterName));
}

/** An existing grant with the same target, if any. */
export async function findDuplicateGrant(
  db: Db,
  guildId: number,
  input: CreateGuildEditorInput,
): Promise<boolean> {
  const target =
    input.kind === 'rank'
      ? eq(ge.rankIndex, input.rankIndex)
      : eq(ge.guildMemberId, input.guildMemberId);
  const rows = await db
    .select({ id: ge.id })
    .from(ge)
    .where(and(eq(ge.guildId, guildId), target))
    .limit(1);
  return rows.length > 0;
}

export async function insertGrant(
  db: Db,
  guildId: number,
  input: CreateGuildEditorInput,
  grantedBy: number,
): Promise<number> {
  const values =
    input.kind === 'rank'
      ? { guildId, kind: 'rank', rankIndex: input.rankIndex, grantedBy }
      : {
          guildId,
          kind: 'member',
          guildMemberId: input.guildMemberId,
          grantedBy,
        };
  const [row] = await db.insert(ge).values(values).returning({ id: ge.id });
  if (!row) throw new Error('guild_editors insert returned no row');
  return row.id;
}

/** Delete one grant of this guild; false when it did not exist. */
export async function deleteGrant(
  db: Db,
  guildId: number,
  editorId: number,
): Promise<boolean> {
  const rows = await db
    .delete(ge)
    .where(and(eq(ge.id, editorId), eq(ge.guildId, guildId)))
    .returning({ id: ge.id });
  return rows.length > 0;
}

/**
 * Postgres unique violation (a concurrent duplicate grant). Drizzle wraps the
 * driver error in `DrizzleQueryError` with SQLSTATE 23505 on `.cause`, so the
 * shared helper checks both `code` and `cause.code`.
 */
export { isUniqueViolation } from '../lineups/lineups-nomination.helpers';
