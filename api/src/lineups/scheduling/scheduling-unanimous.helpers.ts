/**
 * Query, dedup keys and copy for the "everyone picked this time" creator DM
 * (ROK-1632 AC3).
 *
 * Pure module: no NestJS, no DI, so every branch is unit-testable without a
 * module (the `scheduling-vote-write.helpers.ts` precedent). The service that
 * consumes these lives in `scheduling-unanimous.service.ts`.
 */
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { CreateNotificationInput } from '../../notifications/notification.types';

/** One slot that every match member said yes to. */
export interface UnanimousSlotRow {
  matchId: number;
  slotId: number;
  lineupId: number;
  creatorId: number;
  gameName: string;
  /** ISO-8601 with a `Z` suffix — see the `to_char` cast in the query. */
  proposedTime: string;
  /** Every one of them voted yes — used in the copy. */
  memberCount: number;
}

/** Stub — implemented in the green step. */
export function UNANIMOUS_SLOTS_QUERY(_matchId: number | null): SQL {
  return sql`SELECT 1`;
}

/** Stub — implemented in the green step. */
export function unanimousDedupKey(_matchId: number, _slotId: number): string {
  return '';
}

/** Stub — implemented in the green step. */
export function unanimousReminderWindow(
  _matchId: number,
  _slotId: number,
): string {
  return '';
}

/** Stub — implemented in the green step. */
export function buildUnanimousCopy(
  _gameName: string,
  _memberCount: number,
  _proposedTimeIso: string,
): { title: string; message: string } {
  return { title: '', message: '' };
}

/** Stub — implemented in the green step. */
export function buildUnanimousNotification(
  row: UnanimousSlotRow,
  _timeZone: string,
): CreateNotificationInput {
  return {
    userId: row.creatorId,
    type: 'community_lineup',
    title: '',
    message: '',
    payload: {},
  };
}
