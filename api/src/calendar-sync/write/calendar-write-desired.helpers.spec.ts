import {
  computeDesiredState,
  type DesiredStateInput,
} from './calendar-write-desired.helpers';

const NOW = new Date('2026-10-11T12:00:00Z');
const FUTURE = new Date('2026-10-12T12:00:00Z');
const PAST = new Date('2026-10-10T12:00:00Z');
/** A later future end (a moved event). */
const MOVED_END = new Date('2026-10-13T12:00:00Z');

function input(over: Partial<DesiredStateInput> = {}): DesiredStateInput {
  return {
    connection: { status: 'active', writeEnabled: true },
    killSwitchOn: true,
    event: { title: 'Raid Night', cancelled: false, endsAt: FUTURE },
    signupStatus: 'signed_up',
    link: null,
    now: NOW,
    ...over,
  };
}

const SYNCED = { state: 'synced' };

describe('computeDesiredState — active signups', () => {
  it('signed_up without a link → create a Busy copy with the event title', () => {
    expect(computeDesiredState(input())).toEqual({
      action: 'create',
      reason: 'active_signup',
      copy: { tentative: false, benched: false, title: 'Raid Night' },
    });
  });

  it('signed_up with a link → update', () => {
    expect(computeDesiredState(input({ link: SYNCED }))).toEqual({
      action: 'update',
      reason: 'active_signup',
      copy: { tentative: false, benched: false, title: 'Raid Night' },
    });
  });

  it('tentative → a tentative copy (create, then update)', () => {
    const copy = { tentative: true, benched: false, title: 'Raid Night' };
    expect(computeDesiredState(input({ signupStatus: 'tentative' }))).toEqual({
      action: 'create',
      reason: 'active_signup',
      copy,
    });
    expect(
      computeDesiredState(input({ signupStatus: 'tentative', link: SYNCED })),
    ).toEqual({ action: 'update', reason: 'active_signup', copy });
  });

  it('benched (F11) → a benched copy, Free + "(Bench) " downstream', () => {
    const out = computeDesiredState(input({ benched: true, link: SYNCED }));
    expect(out).toEqual({
      action: 'update',
      reason: 'active_signup',
      copy: { tentative: false, benched: true, title: 'Raid Night' },
    });
  });

  it('tentative + benched (F11) → both flags kept; bench wins at render', () => {
    const out = computeDesiredState(
      input({ signupStatus: 'tentative', benched: true }),
    );
    expect(out).toEqual({
      action: 'create',
      reason: 'active_signup',
      copy: { tentative: true, benched: true, title: 'Raid Night' },
    });
  });

  it('a benched declined signup still gets no copy', () => {
    const out = computeDesiredState(
      input({ signupStatus: 'declined', benched: true, link: SYNCED }),
    );
    expect(out).toEqual({
      action: 'delete',
      reason: 'not_signed_up',
      copy: null,
    });
  });

  it('a failed link with an active signup is retried as an update', () => {
    const out = computeDesiredState(input({ link: { state: 'failed' } }));
    expect(out.action).toBe('update');
  });
});

describe('computeDesiredState — not signed up', () => {
  it.each(['declined', 'roached_out', 'departed', null])(
    'status %s with a link → delete',
    (signupStatus) => {
      expect(
        computeDesiredState(input({ signupStatus, link: SYNCED })),
      ).toEqual({ action: 'delete', reason: 'not_signed_up', copy: null });
    },
  );

  it.each(['declined', 'roached_out', 'departed', null])(
    'status %s without a link → noop',
    (signupStatus) => {
      expect(computeDesiredState(input({ signupStatus }))).toEqual({
        action: 'noop',
        reason: 'not_signed_up',
        copy: null,
      });
    },
  );
});

describe('computeDesiredState — event gone, cancelled, write off', () => {
  it('missing event with a link → delete; without → noop', () => {
    expect(computeDesiredState(input({ event: null, link: SYNCED }))).toEqual({
      action: 'delete',
      reason: 'event_missing',
      copy: null,
    });
    expect(computeDesiredState(input({ event: null }))).toEqual({
      action: 'noop',
      reason: 'event_missing',
      copy: null,
    });
  });

  it('cancelled event with a link → delete; without → noop', () => {
    const event = { title: 'Raid Night', cancelled: true, endsAt: FUTURE };
    expect(computeDesiredState(input({ event, link: SYNCED }))).toEqual({
      action: 'delete',
      reason: 'event_cancelled',
      copy: null,
    });
    expect(computeDesiredState(input({ event })).action).toBe('noop');
  });

  it('write disabled with a link → delete; without → noop', () => {
    const connection = { status: 'active', writeEnabled: false };
    expect(computeDesiredState(input({ connection, link: SYNCED }))).toEqual({
      action: 'delete',
      reason: 'write_disabled',
      copy: null,
    });
    expect(computeDesiredState(input({ connection })).action).toBe('noop');
  });
});

describe('computeDesiredState — frozen (never touches the calendar)', () => {
  it('a suppressed link is noop even when the signup is active (Q4)', () => {
    const out = computeDesiredState(input({ link: { state: 'suppressed' } }));
    expect(out).toEqual({ action: 'noop', reason: 'suppressed', copy: null });
  });

  it('a suppressed link is noop even when the event is gone', () => {
    const out = computeDesiredState(
      input({ event: null, link: { state: 'suppressed' } }),
    );
    expect(out).toEqual({ action: 'noop', reason: 'suppressed', copy: null });
  });

  it('kill switch off → noop, the existing copy is kept', () => {
    const out = computeDesiredState(
      input({ killSwitchOn: false, signupStatus: 'declined', link: SYNCED }),
    );
    expect(out).toEqual({
      action: 'noop',
      reason: 'kill_switch_off',
      copy: null,
    });
  });

  it.each(['needs_reconnect', 'error', 'disconnecting'])(
    'connection %s → noop',
    (status) => {
      const connection = { status, writeEnabled: true };
      expect(computeDesiredState(input({ connection, link: SYNCED }))).toEqual({
        action: 'noop',
        reason: 'connection_inactive',
        copy: null,
      });
    },
  );

  it('ended event (end = now) is frozen: no update for an active signup (F5)', () => {
    const event = { title: 'Raid Night', cancelled: false, endsAt: NOW };
    expect(computeDesiredState(input({ event, link: SYNCED }))).toEqual({
      action: 'noop',
      reason: 'event_ended',
      copy: null,
    });
  });

  it('ended event is frozen: no delete after a decline or a cancel (F5)', () => {
    const ended = { title: 'Raid Night', cancelled: false, endsAt: PAST };
    const declined = input({
      event: ended,
      signupStatus: 'declined',
      link: SYNCED,
    });
    expect(computeDesiredState(declined).reason).toBe('event_ended');
    const cancelled = input({
      event: { ...ended, cancelled: true },
      link: SYNCED,
    });
    expect(computeDesiredState(cancelled)).toEqual({
      action: 'noop',
      reason: 'event_ended',
      copy: null,
    });
  });
});

describe('computeDesiredState — rescheduling poll (ROK-1857)', () => {
  const polling = { title: 'Raid Night', cancelled: false, endsAt: FUTURE };
  const underPoll = { ...polling, rescheduling: true };

  it('under a poll with a copy → delete it', () => {
    expect(
      computeDesiredState(input({ event: underPoll, link: SYNCED })),
    ).toEqual({ action: 'delete', reason: 'rescheduling', copy: null });
  });

  it('under a poll without a copy (reschedule before lock-in) → noop', () => {
    expect(computeDesiredState(input({ event: underPoll }))).toEqual({
      action: 'noop',
      reason: 'rescheduling',
      copy: null,
    });
  });

  it('poll closed at a new time (copy deleted at open) → create', () => {
    const closed = { ...polling, rescheduling: false, endsAt: MOVED_END };
    expect(computeDesiredState(input({ event: closed }))).toEqual({
      action: 'create',
      reason: 'active_signup',
      copy: { tentative: false, benched: false, title: 'Raid Night' },
    });
  });

  it('poll aborted (original time) → create a fresh copy', () => {
    const out = computeDesiredState(
      input({ event: { ...polling, rescheduling: false } }),
    );
    expect(out.action).toBe('create');
    expect(out.reason).toBe('active_signup');
  });

  it('cancelled mid-poll → event_cancelled wins (delete with a copy)', () => {
    const event = { ...underPoll, cancelled: true };
    expect(computeDesiredState(input({ event, link: SYNCED }))).toEqual({
      action: 'delete',
      reason: 'event_cancelled',
      copy: null,
    });
    expect(computeDesiredState(input({ event })).reason).toBe(
      'event_cancelled',
    );
  });

  it('a suppressed copy stays frozen under a poll', () => {
    const link = { state: 'suppressed' };
    expect(computeDesiredState(input({ event: underPoll, link }))).toEqual({
      action: 'noop',
      reason: 'suppressed',
      copy: null,
    });
  });

  it('needs_reconnect stays frozen under a poll', () => {
    const connection = { status: 'needs_reconnect', writeEnabled: true };
    const out = computeDesiredState(
      input({ connection, event: underPoll, link: SYNCED }),
    );
    expect(out).toEqual({
      action: 'noop',
      reason: 'connection_inactive',
      copy: null,
    });
  });

  it('no poll + a time change (manual edit) → update in place', () => {
    const moved = { ...polling, rescheduling: false, endsAt: MOVED_END };
    expect(computeDesiredState(input({ event: moved, link: SYNCED }))).toEqual({
      action: 'update',
      reason: 'active_signup',
      copy: { tentative: false, benched: false, title: 'Raid Night' },
    });
  });
});
