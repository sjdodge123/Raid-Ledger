/**
 * ROK-1596 D2 (epic ROK-669 §4.5.2.1): what the reconcile job should do for
 * one (connection, event, user) triple. Pure — the caller loads the rows.
 */

export type DesiredAction = 'create' | 'update' | 'delete' | 'noop';

/** Why the decision was reached — logged by the processor, asserted in specs. */
export type DesiredReason =
  | 'suppressed'
  | 'kill_switch_off'
  | 'connection_inactive'
  | 'event_ended'
  | 'event_missing'
  | 'event_cancelled'
  | 'write_disabled'
  | 'not_signed_up'
  | 'active_signup';

export interface DesiredStateInput {
  connection: { status: string; writeEnabled: boolean };
  killSwitchOn: boolean;
  /** null when the event row is gone. */
  event: { title: string; cancelled: boolean; endsAt: Date } | null;
  /** The user's signup status for the event; null when there is no signup. */
  signupStatus: string | null;
  link: { state: string } | null;
  now: Date;
}

export interface DesiredCopy {
  tentative: boolean;
  title: string;
}

export interface DesiredState {
  action: DesiredAction;
  reason: DesiredReason;
  /** Set for `create` / `update` only. */
  copy: DesiredCopy | null;
}

/** Statuses that keep a copy on the calendar (always both; no toggle). */
const COPY_STATUSES: ReadonlySet<string> = new Set(['signed_up', 'tentative']);

const noop = (reason: DesiredReason): DesiredState => ({
  action: 'noop',
  reason,
  copy: null,
});

/** Not desired: delete our copy when one exists, else nothing to do. */
function removal(input: DesiredStateInput, reason: DesiredReason) {
  return input.link
    ? { action: 'delete' as const, reason, copy: null }
    : noop(reason);
}

/** Guards that stop the job touching the calendar at all. */
function frozenReason(input: DesiredStateInput): DesiredReason | null {
  if (input.link?.state === 'suppressed') return 'suppressed';
  if (!input.killSwitchOn) return 'kill_switch_off';
  // A connection that cannot write (needs_reconnect / error / disconnecting)
  // is left alone; reconnect + the nightly reconcile, or the disconnect job,
  // own its copies.
  if (input.connection.status !== 'active') return 'connection_inactive';
  if (input.event && input.event.endsAt.getTime() <= input.now.getTime()) {
    return 'event_ended'; // F5: copies of ended events are frozen
  }
  return null;
}

export function computeDesiredState(input: DesiredStateInput): DesiredState {
  const frozen = frozenReason(input);
  if (frozen) return noop(frozen);
  const { event, signupStatus } = input;
  if (!event) return removal(input, 'event_missing');
  if (event.cancelled) return removal(input, 'event_cancelled');
  if (!input.connection.writeEnabled) return removal(input, 'write_disabled');
  if (!signupStatus || !COPY_STATUSES.has(signupStatus)) {
    return removal(input, 'not_signed_up');
  }
  return {
    action: input.link ? 'update' : 'create',
    reason: 'active_signup',
    copy: { tentative: signupStatus === 'tentative', title: event.title },
  };
}
