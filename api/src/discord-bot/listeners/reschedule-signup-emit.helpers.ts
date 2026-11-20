import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot.constants';
import type { RescheduleDeps } from './reschedule-response.helpers';

/** The signup columns a thread signup line reflects (ROK-2271). */
export interface LineFields {
  status: string;
  preferredRoles: string[] | null;
  roachedOutAt: Date | null;
}

function sameRoles(before: string[] | null, after: unknown): boolean {
  if (!Array.isArray(after)) return true;
  const prev = before ?? [];
  return prev.length === after.length && prev.every((r, i) => r === after[i]);
}

/**
 * Whether a reschedule write `set` changes something the signup line shows:
 * the status, a cleared roach-out, or the roles (which drive the roster slot).
 */
export function lineFieldsChanged(
  before: LineFields,
  set: Record<string, unknown>,
): boolean {
  if ('status' in set && set.status !== before.status) return true;
  if ('roachedOutAt' in set && before.roachedOutAt !== null) return true;
  return !sameRoles(before.preferredRoles, set.preferredRoles);
}

/**
 * ROK-2271 — announce a reschedule write to the `signup.updated` listeners
 * (the thread's debounced signup-line flush among them). Call after the
 * write succeeded, once per changed signup.
 */
export function announceIfLineChanged(
  deps: Pick<RescheduleDeps, 'eventEmitter'>,
  eventId: number,
  signup: LineFields & { id: number },
  set: Record<string, unknown>,
  userId?: number,
): void {
  if (!lineFieldsChanged(signup, set)) return;
  const ids = { eventId, signupId: signup.id };
  const payload = userId === undefined ? ids : { ...ids, userId };
  emitSignupUpdated(deps, { ...payload, action: 'reschedule_reconfirm' });
}

/** Emit one `signup.updated` (decline + reconfirm share it). */
export function emitSignupUpdated(
  deps: Pick<RescheduleDeps, 'eventEmitter'>,
  payload: SignupEventPayload,
): void {
  deps.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, payload);
}
