/**
 * Write-boundary guard for manual absences (ROK-1842): a per-user cap and an
 * exact-duplicate check, so repeated valid POSTs cannot pile up rows that
 * every composite read then has to walk.
 *
 * Only `manual` rows count: `calendar` rows are derived (and already merged)
 * by the sync, not written by the member.
 */
import { ConflictException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, count, eq } from 'drizzle-orm';
import { ABSENCE_MAX_PER_USER } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** 409 messages for a refused absence write. */
export const ABSENCE_LIMIT_MESSAGES = {
  duplicate: 'an absence with these exact dates already exists',
  overCap: `you can store at most ${ABSENCE_MAX_PER_USER} absences; delete an old one first`,
} as const;

const a = schema.gameTimeAbsences;

/** Manual absences the user has stored. */
async function countManual(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(a)
    .where(and(eq(a.userId, userId), eq(a.source, 'manual')));
  return row?.n ?? 0;
}

/** True when a manual absence with exactly these dates exists. */
async function hasExactDuplicate(
  db: Db,
  userId: number,
  span: { startDate: string; endDate: string },
): Promise<boolean> {
  const rows = await db
    .select({ id: a.id })
    .from(a)
    .where(
      and(
        eq(a.userId, userId),
        eq(a.source, 'manual'),
        eq(a.startDate, span.startDate),
        eq(a.endDate, span.endDate),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Refuse a new manual absence that duplicates an existing span or would push
 * the user past `ABSENCE_MAX_PER_USER`.
 * @throws ConflictException (409) with an `ABSENCE_LIMIT_MESSAGES` message.
 */
export async function assertAbsenceWritable(
  db: Db,
  userId: number,
  span: { startDate: string; endDate: string },
): Promise<void> {
  if (await hasExactDuplicate(db, userId, span)) {
    throw new ConflictException(ABSENCE_LIMIT_MESSAGES.duplicate);
  }
  if ((await countManual(db, userId)) >= ABSENCE_MAX_PER_USER) {
    throw new ConflictException(ABSENCE_LIMIT_MESSAGES.overCap);
  }
}
