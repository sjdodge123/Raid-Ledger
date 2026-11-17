/**
 * Signup statuses that no longer hold a place on an event. The event page's
 * `signupCount` and the hub forum's event-thread header (ROK-2229) both
 * exclude them, so the two numbers always agree. Bench signups still count.
 */
export const INACTIVE_SIGNUP_STATUSES = [
  'roached_out',
  'departed',
  'declined',
] as const;
