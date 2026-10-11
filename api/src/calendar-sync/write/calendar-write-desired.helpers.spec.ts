import {
  computeDesiredState,
  type DesiredStateInput,
} from './calendar-write-desired.helpers';

const NOW = new Date('2026-10-11T12:00:00Z');
const FUTURE = new Date('2026-10-12T12:00:00Z');
const PAST = new Date('2026-10-10T12:00:00Z');

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
      copy: { tentative: false, title: 'Raid Night' },
    });
  });

  it('signed_up with a link → update', () => {
    expect(computeDesiredState(input({ link: SYNCED }))).toEqual({
      action: 'update',
      reason: 'active_signup',
      copy: { tentative: false, title: 'Raid Night' },
    });
  });

  it('tentative → a tentative copy (create, then update)', () => {
    const copy = { tentative: true, title: 'Raid Night' };
    expect(computeDesiredState(input({ signupStatus: 'tentative' }))).toEqual({
      action: 'create',
      reason: 'active_signup',
      copy,
    });
    expect(
      computeDesiredState(input({ signupStatus: 'tentative', link: SYNCED })),
    ).toEqual({ action: 'update', reason: 'active_signup', copy });
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
