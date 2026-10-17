/**
 * Signup statuses that still occupy the member's evening. The complement —
 * `declined`, `roached_out`, `departed` — has released the slot, so those hours
 * are free again. One constant so the heatmap cannot drift from the roster.
 *
 * Dependency-free on purpose (type-only import): both the scheduling busy
 * helpers and the calendar busy query read it, and they import each other's
 * neighbours — keeping it here breaks that cycle (ROK-1593).
 */
import type { SignupStatus } from '../../drizzle/schema/event-signups';

export const ACTIVE_SIGNUP_STATUSES: readonly SignupStatus[] = [
  'signed_up',
  'tentative',
];
