import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
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

/** U+200C ZWNJ / U+200D ZWJ — allowed inside hub names since ROK-2016. */
const JOINERS = /[\u200C\u200D]/g;

/**
 * D11 key: case-insensitive, trimmed, NFC, joiners stripped (ROK-1950 review /
 * ROK-2016: one key per visual name, so a name differing only by a ZWJ/ZWNJ
 * is "name taken").
 */
export function hubNameKey(name: string): string {
  return name.trim().normalize('NFC').replace(JOINERS, '').toLowerCase();
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

/** Advisory-lock namespace of a proposer's limit check + insert (P14). */
const PROPOSER_LOCK_NS = 1870;

/**
 * P14: serialise one proposer's D12 limit check and insert — a transaction-
 * scoped advisory lock on (namespace, user id). Run inside a transaction.
 */
export async function lockProposer(tx: DbOrTx, userId: number): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${PROPOSER_LOCK_NS}::int, ${userId}::int)`,
  );
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
      // ROK-1893 §8b: new community hubs ask signers to join; old rows stay `off`.
      autoMembership: 'suggest',
    })
    .returning();
  if (!row) throw new Error('community hub insert returned no row');
  return row;
}

/** ROK-1892: a staff proposal is read back `active` (auto-approved). */
export type ProposalStatus = 'proposed' | 'active';

function proposalWhere(
  extra?: SQL,
  status: ProposalStatus = 'proposed',
): SQL | undefined {
  return and(eq(g.kind, COMMUNITY), eq(g.status, status), extra);
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
  filter?: { proposedBy?: number; ids?: number[]; status?: ProposalStatus },
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
    .where(proposalWhere(and(...extra), filter?.status))
    .orderBy(asc(g.createdAt), asc(g.id));
  return rows.map(toHubProposal);
}

/** A proposal row (+ game, proposer) → contract `HubProposal`; `status` is the row's (ROK-1892). */
function toHubProposal({
  hub,
  game,
  user,
}: {
  hub: schema.GuildSelect;
  game: typeof games.$inferSelect;
  user: typeof u.$inferSelect;
}): HubProposal {
  return {
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
    status: hub.status,
  };
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
