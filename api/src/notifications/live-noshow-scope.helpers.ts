/**
 * The signup population every live no-show phase judges (TDB:372).
 *
 * Phase 1 candidates (`fetchNonBenchSignups`), Phase 2 running-late grace
 * (`fetchLateGraceByUserId`) and Phase 2 escalation candidates
 * (`getPhase1RemindedUserIds`) must all read the same set: signups still
 * `status = 'signed_up'` and not on the bench. If one of them drifts, a player
 * benched or roached-out between +5 and +15 is treated differently by each
 * phase — e.g. named in the creator's "slot is free to PUG" alert.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** `event_signups` rows that count as an active, non-bench roster member. */
export function activeNonBenchSignup(): SQL {
  return and(
    eq(schema.eventSignups.status, 'signed_up'),
    sql`NOT EXISTS (SELECT 1 FROM ${schema.rosterAssignments} WHERE ${schema.rosterAssignments.eventId} = ${schema.eventSignups.eventId} AND ${schema.rosterAssignments.signupId} = ${schema.eventSignups.id} AND ${schema.rosterAssignments.role} = 'bench')`,
  )!;
}
