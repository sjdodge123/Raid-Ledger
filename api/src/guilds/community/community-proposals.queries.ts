import { and, asc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import type { HubProposal } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { DbOrTx } from './community-membership.queries';

/**
 * ROK-1870 L2b — the `guilds` reads/writes behind proposals. A proposal is a
 * `guilds` row with `kind='game_community', status='proposed'` (D1, D8).
 */

const g = schema.guilds;
const games = schema.games;
const u = schema.users;
const COMMUNITY = 'game_community';

/** The D1 columns every community hub row carries. */
export interface NewCommunityHub {
  gameId: number;
  name: string;
  blurb: string;
  status: 'proposed' | 'active';
  proposedBy: number | null;
  reviewedBy: number | null;
}

/** D11 key: case-insensitive, trimmed. */
export function hubNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The game's name, or null when the game does not exist. */
export async function findGameName(
  db: DbOrTx,
  gameId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ name: games.name })
    .from(games)
    .where(eq(games.id, gameId));
  return row?.name ?? null;
}

/** D11: a non-archived community hub on the game already uses the name. */
export async function hasNameClash(
  db: DbOrTx,
  gameId: number,
  name: string,
  exceptId: number | null = null,
): Promise<boolean> {
  const conds: (SQL | undefined)[] = [
    eq(g.kind, COMMUNITY),
    eq(g.gameId, gameId),
    eq(g.nameKey, hubNameKey(name)),
    ne(g.status, 'archived'),
  ];
  if (exceptId !== null) conds.push(ne(g.id, exceptId));
  const [row] = await db
    .select({ id: g.id })
    .from(g)
    .where(and(...conds))
    .limit(1);
  return row !== undefined;
}

/** The user's open proposals' game ids (D12 limits). */
export async function openProposalGameIds(
  db: DbOrTx,
  userId: number,
): Promise<number[]> {
  const rows = await db
    .select({ gameId: g.gameId })
    .from(g)
    .where(proposalWhere(eq(g.proposedBy, userId)));
  return rows.map((r) => r.gameId);
}

/** Insert a community hub row (D1 constants filled in). */
export async function insertCommunityHub(
  db: DbOrTx,
  hub: NewCommunityHub,
): Promise<schema.GuildSelect> {
  const name = hub.name.trim();
  const [row] = await db
    .insert(g)
    .values({
      gameId: hub.gameId,
      kind: COMMUNITY,
      region: 'community',
      source: 'community',
      name,
      nameKey: hubNameKey(name),
      blurb: hub.blurb.trim(),
      status: hub.status,
      proposedBy: hub.proposedBy,
      reviewedBy: hub.reviewedBy,
      reviewedAt: hub.reviewedBy === null ? null : new Date(),
    })
    .returning();
  if (!row) throw new Error('community hub insert returned no row');
  return row;
}

function proposalWhere(extra?: SQL): SQL | undefined {
  return and(eq(g.kind, COMMUNITY), eq(g.status, 'proposed'), extra);
}

/** A proposed row, locked `FOR UPDATE` when called inside a transaction. */
export async function lockProposal(
  db: DbOrTx,
  id: number,
): Promise<schema.GuildSelect | null> {
  const [row] = await db
    .select()
    .from(g)
    .where(proposalWhere(eq(g.id, id)))
    .for('update');
  return row ?? null;
}

/** Proposals as the contract `HubProposal`, oldest first. */
export async function listProposals(
  db: DbOrTx,
  filter?: { proposedBy?: number; ids?: number[] },
): Promise<HubProposal[]> {
  const extra: SQL[] = [];
  if (filter?.proposedBy !== undefined)
    extra.push(eq(g.proposedBy, filter.proposedBy));
  if (filter?.ids !== undefined) extra.push(inArray(g.id, filter.ids));
  const rows = await db
    .select({ hub: g, game: games, user: u })
    .from(g)
    .innerJoin(games, eq(games.id, g.gameId))
    .innerJoin(u, eq(u.id, g.proposedBy))
    .where(proposalWhere(and(...extra)))
    .orderBy(asc(g.createdAt), asc(g.id));
  return rows.map(({ hub, game, user }) => ({
    id: hub.id,
    gameId: hub.gameId,
    gameName: game.name,
    gameIconUrl: game.coverUrl,
    name: hub.name,
    blurb: hub.blurb ?? '',
    proposedBy: {
      userId: user.id,
      username: user.username,
      avatarUrl: user.customAvatarUrl ?? null,
    },
    createdAt: hub.createdAt.toISOString(),
  }));
}

/** Approve: active + reviewed; optional tidy of name/blurb. */
export async function activateProposal(
  db: DbOrTx,
  id: number,
  patch: {
    reviewedBy: number;
    name?: string | undefined;
    blurb?: string | undefined;
  },
): Promise<schema.GuildSelect> {
  const now = new Date();
  const [row] = await db
    .update(g)
    .set({
      status: 'active',
      reviewedBy: patch.reviewedBy,
      reviewedAt: now,
      updatedAt: now,
      ...(patch.name !== undefined
        ? { name: patch.name.trim(), nameKey: hubNameKey(patch.name) }
        : {}),
      ...(patch.blurb !== undefined ? { blurb: patch.blurb.trim() } : {}),
    })
    .where(eq(g.id, id))
    .returning();
  if (!row) throw new Error(`proposal ${id} vanished during approve`);
  return row;
}

/** Delete a still-proposed row; true when one was removed. */
export async function deleteProposal(
  db: DbOrTx,
  id: number,
  proposedBy?: number,
): Promise<boolean> {
  const own =
    proposedBy === undefined ? undefined : eq(g.proposedBy, proposedBy);
  const rows = await db
    .delete(g)
    .where(proposalWhere(and(eq(g.id, id), own)))
    .returning({ id: g.id });
  return rows.length > 0;
}
