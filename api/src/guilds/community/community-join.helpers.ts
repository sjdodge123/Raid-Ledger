import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubJoinSource } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { HUB_NOT_FOUND } from '../hub-hidden.helpers';
import {
  assertInDiscord,
  isLive,
  requireCommunityHub,
} from './community-hub.lookup';
import {
  findMembership,
  lockHubRow,
  upsertJoin,
  type DbOrTx,
} from './community-membership.queries';

/**
 * ROK-1893 P1 (D3) — the two halves of a hub join, shared by
 * `CommunityMembershipService.joinVia` and the invite redeemer (which runs
 * the locked half inside its own transaction, after locking the invite row).
 */

/** 403 copy for a banned joiner. */
export const BANNED_FROM_HUB = "You can't join this hub";

/** Options of `joinVia`. */
export interface JoinViaOptions {
  /** The redeemed link (`source = 'invite'`). */
  inviteId?: number;
  /** A2 check (in the community Discord). Defaults to true. */
  requireDiscord?: boolean;
}

/** Result of `joinVia`: `joined` is false when the user was already live. */
export interface JoinViaResult {
  joined: boolean;
  memberCount: number;
}

/**
 * Pre-transaction checks, read through the pool (never while a hub lock is
 * held): 404 unless an active community hub, 403 when banned, 403 when the
 * Discord check applies and fails. An already-live member skips Discord.
 * Returns the hub (its game feeds the ROK-1873 join nudge).
 */
export async function assertMayJoin(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  hubId: number,
  requireDiscord: boolean,
): Promise<schema.GuildSelect> {
  const hub = await requireCommunityHub(db, hubId, true);
  const existing = await findMembership(db, hubId, userId);
  if (existing?.bannedAt) throw new ForbiddenException(BANNED_FROM_HUB);
  if (requireDiscord && !isLive(existing)) {
    await assertInDiscord(db, userId, false);
  }
  return hub;
}

/**
 * The locked half: lock the hub row (must be `active`), upsert the
 * membership with its provenance. True when a NEW live row resulted (insert
 * or revival); false when the user was already a live member.
 */
export async function joinLocked(
  tx: DbOrTx,
  hubId: number,
  userId: number,
  source: HubJoinSource,
  inviteId: number | null,
): Promise<boolean> {
  if ((await lockHubRow(tx, hubId))?.status !== 'active') {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  const before = await findMembership(tx, hubId, userId);
  const row = await upsertJoin(tx, hubId, userId, 'member', {
    joinSource: source,
    inviteId,
  });
  if (row.bannedAt) throw new ForbiddenException(BANNED_FROM_HUB);
  return !isLive(before);
}
