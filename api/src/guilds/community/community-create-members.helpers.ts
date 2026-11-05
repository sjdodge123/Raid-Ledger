/**
 * ROK-2096 — the first members an admin seeds on a direct create
 * (`POST /admin/hubs`, operator ruling 2026-11-05). Self-serve Join (ROK-1870
 * R2) is unchanged; these rows are `role='member'` with no join provenance,
 * like the leader row.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { upsertJoin, type DbOrTx } from './community-membership.queries';

export const CREATE_MEMBER_ERRORS = {
  notFound: 'One or more members were not found',
  inactive: 'One or more members are no longer active',
} as const;

/** Distinct ids, without the leader, in first-seen order. */
export function initialMemberIds(
  leaderId: number,
  ids: readonly number[] | undefined,
): number[] {
  return [...new Set(ids ?? [])].filter((id) => id !== leaderId);
}

/**
 * Check every id names an active user before anything is written: an unknown
 * id is 404 and a deactivated one 409, matching the leader checks.
 */
export async function assertMembersActive(
  db: DbOrTx,
  ids: readonly number[],
): Promise<void> {
  if (ids.length === 0) return;
  const u = schema.users;
  const rows = await db
    .select({ id: u.id, deactivatedAt: u.deactivatedAt })
    .from(u)
    .where(inArray(u.id, [...ids]));
  if (rows.length !== ids.length) {
    throw new NotFoundException(CREATE_MEMBER_ERRORS.notFound);
  }
  if (rows.some((r) => r.deactivatedAt !== null)) {
    throw new ConflictException(CREATE_MEMBER_ERRORS.inactive);
  }
}

/** Insert the member rows inside the create transaction (the hub is brand new, so no row exists yet). */
export async function seedMembers(
  tx: DbOrTx,
  hubId: number,
  ids: readonly number[],
): Promise<void> {
  for (const userId of ids) await upsertJoin(tx, hubId, userId, 'member');
}
