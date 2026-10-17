/**
 * ROK-1617: the stance transition rule.
 *
 * These are the five transitions the story names, asserted on the pure
 * decision rather than through a mocked transaction — the interesting part is
 * WHICH write happens, not that Drizzle was called.
 */
import type { ScheduleVoteStance } from '@raid-ledger/contract';
import {
  resolveStanceAction,
  isAnswering,
  isYesStance,
  stanceTallyFor,
  tallyStancesBySlot,
} from './scheduling-stance.helpers';

/** A value the CHECK constraint forbids — the drift case these guard. */
const UNKNOWN_STANCE = 'maybe' as unknown as ScheduleVoteStance;

describe('resolveStanceAction', () => {
  it('none -> yes inserts a yes', () => {
    expect(resolveStanceAction(null, 'yes')).toEqual({
      kind: 'inserted',
      stance: 'yes',
    });
  });

  it('none -> no inserts a no', () => {
    expect(resolveStanceAction(null, 'no')).toEqual({
      kind: 'inserted',
      stance: 'no',
    });
  });

  it('yes -> no CHANGES the existing row rather than adding one', () => {
    // AC2: uq_schedule_vote_user already holds one row per (slot, user), so a
    // second INSERT would violate it. The action must be an update.
    expect(resolveStanceAction('yes', 'no')).toEqual({
      kind: 'changed',
      stance: 'no',
    });
  });

  it('no -> yes changes back', () => {
    expect(resolveStanceAction('no', 'yes')).toEqual({
      kind: 'changed',
      stance: 'yes',
    });
  });

  it('pressing yes twice clears back to not answered', () => {
    expect(resolveStanceAction('yes', 'yes')).toEqual({
      kind: 'cleared',
      stance: null,
    });
  });

  it('pressing no twice clears back to not answered (misclick recovery)', () => {
    // The whole point of AC2's clearing rule: a member who mis-taps "doesn't
    // work" must not be stranded on a `no` they never meant to cast.
    expect(resolveStanceAction('no', 'no')).toEqual({
      kind: 'cleared',
      stance: null,
    });
  });
});

describe('isAnswering', () => {
  it('is true for an insert and for a stance change', () => {
    expect(isAnswering(resolveStanceAction(null, 'no'))).toBe(true);
    expect(isAnswering(resolveStanceAction('yes', 'no'))).toBe(true);
  });

  it('is false when clearing, so a past slot can still be un-answered', () => {
    // ROK-1607's guard blocks ANSWERING a slot whose time has passed. A
    // withdrawal must stay legal or a Friday voter could never untick it on
    // Saturday.
    expect(isAnswering(resolveStanceAction('yes', 'yes'))).toBe(false);
  });
});

describe('isYesStance', () => {
  it('is true for an explicit yes', () => {
    expect(isYesStance('yes')).toBe(true);
  });

  it('is true for an absent stance (the column default)', () => {
    expect(isYesStance(undefined)).toBe(true);
    expect(isYesStance(null)).toBe(true);
  });

  it('is false for a no', () => {
    expect(isYesStance('no')).toBe(false);
  });

  it('is false for a stance the schema does not know', () => {
    expect(isYesStance(UNKNOWN_STANCE)).toBe(false);
  });
});

describe('tallyStancesBySlot', () => {
  it('counts an unknown stance as neither a yes nor a no', () => {
    // A support count must never grow from a value that is not literally
    // `yes` — the same rule the SQL tallies apply with `stance = 'yes'`.
    const tallies = tallyStancesBySlot([{ slotId: 7, stance: UNKNOWN_STANCE }]);
    expect(stanceTallyFor(tallies, 7)).toEqual({ voteCount: 0, noCount: 0 });
  });
});
