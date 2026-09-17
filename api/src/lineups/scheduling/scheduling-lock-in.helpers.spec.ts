/**
 * ROK-1610 — the three questions a post-expiry lock-in asks, in isolation.
 *
 * The READ path (what the page offers) and the WRITE path (what the service
 * accepts) both run these, so a disagreement here is a disagreement between
 * the banner and the endpoint.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  assertCallerMayLockIn,
  assertSlotIsFuture,
  findLeadingLockableSlot,
  isPollOrganiser,
  resolveLockInPageState,
} from './scheduling-lock-in.helpers';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const PAST = new Date('2026-09-01T20:00:00.000Z');
const SOON = new Date('2026-10-01T20:00:00.000Z');
const LATER = new Date('2026-10-10T21:00:00.000Z');

const ORGANISER = { createdBy: 7 };

describe('findLeadingLockableSlot', () => {
  it('picks the most-voted FUTURE slot', () => {
    const slots = [
      { id: 1, proposedTime: SOON },
      { id: 2, proposedTime: LATER },
    ];
    const votes = [{ slotId: 1 }, { slotId: 2 }, { slotId: 2 }, { slotId: 2 }];

    expect(findLeadingLockableSlot(slots, votes, NOW)).toBe(2);
  });

  it('ignores a past slot even when it is the most voted (AC2)', () => {
    const slots = [
      { id: 1, proposedTime: PAST },
      { id: 2, proposedTime: LATER },
    ];
    const votes = [{ slotId: 1 }, { slotId: 1 }, { slotId: 1 }, { slotId: 2 }];

    expect(findLeadingLockableSlot(slots, votes, NOW)).toBe(2);
  });

  it('returns null when every slot has passed (the PEAK case)', () => {
    const slots = [{ id: 1, proposedTime: PAST }];

    expect(findLeadingLockableSlot(slots, [{ slotId: 1 }], NOW)).toBeNull();
  });

  it('returns null when the future slots have no votes', () => {
    const slots = [{ id: 9, proposedTime: LATER }];

    expect(findLeadingLockableSlot(slots, [], NOW)).toBeNull();
  });
});

describe('isPollOrganiser / assertCallerMayLockIn', () => {
  it("accepts the poll's creator", () => {
    expect(isPollOrganiser(ORGANISER, { id: 7 })).toBe(true);
    expect(() => assertCallerMayLockIn(ORGANISER, { id: 7 })).not.toThrow();
  });

  it('accepts an admin or operator who did not create the poll', () => {
    expect(isPollOrganiser(ORGANISER, { id: 99, role: 'admin' })).toBe(true);
    expect(isPollOrganiser(ORGANISER, { id: 99, role: 'operator' })).toBe(true);
  });

  it('refuses an ordinary member (AC3)', () => {
    expect(isPollOrganiser(ORGANISER, { id: 99, role: 'member' })).toBe(false);
    expect(() =>
      assertCallerMayLockIn(ORGANISER, { id: 99, role: 'member' }),
    ).toThrow(ForbiddenException);
  });

  it('refuses everyone when the lineup row is missing', () => {
    expect(isPollOrganiser(undefined, { id: 7 })).toBe(false);
  });
});

describe('assertSlotIsFuture', () => {
  it('passes a future time', () => {
    expect(() => assertSlotIsFuture(LATER, NOW)).not.toThrow();
  });

  it('refuses a time that has already passed', () => {
    expect(() => assertSlotIsFuture(PAST, NOW)).toThrow(BadRequestException);
    expect(() => assertSlotIsFuture(PAST, NOW)).toThrow(
      'That time has already passed',
    );
  });

  it('refuses the present instant (a slot starting now is not schedulable)', () => {
    expect(() => assertSlotIsFuture(NOW, NOW)).toThrow(BadRequestException);
  });
});

describe('resolveLockInPageState', () => {
  const slots = [
    { id: 1, proposedTime: PAST },
    { id: 2, proposedTime: LATER },
  ];
  const votes = [{ slotId: 1 }, { slotId: 2 }];

  it('offers the organiser the leading future slot on an EXPIRED poll (AC1)', () => {
    expect(
      resolveLockInPageState({
        pollStatus: 'closed',
        lineup: ORGANISER,
        caller: { id: 7 },
        slots,
        votes,
        now: NOW,
      }),
    ).toEqual({ canLockIn: true, lockInSlotId: 2 });
  });

  it('names the slot but withholds the action from a member (AC3)', () => {
    expect(
      resolveLockInPageState({
        pollStatus: 'closed',
        lineup: ORGANISER,
        caller: { id: 99, role: 'member' },
        slots,
        votes,
        now: NOW,
      }),
    ).toEqual({ canLockIn: false, lockInSlotId: 2 });
  });

  it('offers nothing when every slot has passed (AC2)', () => {
    expect(
      resolveLockInPageState({
        pollStatus: 'closed',
        lineup: ORGANISER,
        caller: { id: 7 },
        slots: [slots[0]],
        votes: [{ slotId: 1 }],
        now: NOW,
      }),
    ).toEqual({ canLockIn: false, lockInSlotId: null });
  });

  it.each(['open', 'locked_in', 'cancelled'] as const)(
    'offers nothing on a %s poll — this is the expiry affordance only',
    (pollStatus) => {
      expect(
        resolveLockInPageState({
          pollStatus,
          lineup: ORGANISER,
          caller: { id: 7 },
          slots,
          votes,
          now: NOW,
        }),
      ).toEqual({ canLockIn: false, lockInSlotId: null });
    },
  );

  it('offers nothing to an anonymous viewer', () => {
    expect(
      resolveLockInPageState({
        pollStatus: 'closed',
        lineup: ORGANISER,
        caller: null,
        slots,
        votes,
        now: NOW,
      }).canLockIn,
    ).toBe(false);
  });
});
