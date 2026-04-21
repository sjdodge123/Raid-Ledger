/**
 * Unit tests for canParticipateInLineup (ROK-1065).
 * Mirror the server's assertUserCanParticipate so the UI disables write
 * actions for non-invitees on private lineups. Covers all 6 branches.
 */
import { describe, expect, it } from 'vitest';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { canParticipateInLineup } from './lineup-eligibility';

type LineupShape = Pick<
  LineupDetailResponseDto,
  'visibility' | 'createdBy' | 'invitees'
>;

function makePrivateLineup(overrides: Partial<LineupShape> = {}): LineupShape {
  return {
    visibility: 'private',
    createdBy: { id: 1, displayName: 'Operator' },
    invitees: [],
    ...overrides,
  };
}

describe('canParticipateInLineup', () => {
  it('returns false when the lineup is null', () => {
    expect(canParticipateInLineup(null, { id: 5 })).toBe(false);
  });

  it('returns false when the lineup is undefined', () => {
    expect(canParticipateInLineup(undefined, { id: 5 })).toBe(false);
  });

  it('returns true for a public lineup regardless of user', () => {
    const lineup: LineupShape = {
      visibility: 'public',
      createdBy: { id: 1, displayName: 'Op' },
      invitees: [],
    };
    expect(canParticipateInLineup(lineup, null)).toBe(true);
    expect(canParticipateInLineup(lineup, undefined)).toBe(true);
    expect(canParticipateInLineup(lineup, { id: 99 })).toBe(true);
  });

  it('returns false for a private lineup when the user is anonymous', () => {
    expect(canParticipateInLineup(makePrivateLineup(), null)).toBe(false);
    expect(canParticipateInLineup(makePrivateLineup(), undefined)).toBe(false);
  });

  it('grants access to admins on a private lineup', () => {
    expect(
      canParticipateInLineup(makePrivateLineup(), { id: 77, role: 'admin' }),
    ).toBe(true);
  });

  it('grants access to operators on a private lineup', () => {
    expect(
      canParticipateInLineup(makePrivateLineup(), { id: 77, role: 'operator' }),
    ).toBe(true);
  });

  it('grants access to the creator of a private lineup', () => {
    const lineup = makePrivateLineup({
      createdBy: { id: 42, displayName: 'Owner' },
    });
    expect(canParticipateInLineup(lineup, { id: 42, role: 'member' })).toBe(
      true,
    );
  });

  it('grants access to an explicit invitee on a private lineup', () => {
    const lineup = makePrivateLineup({
      invitees: [
        { id: 10, displayName: 'A', steamLinked: false },
        { id: 11, displayName: 'B', steamLinked: true },
      ],
    });
    expect(canParticipateInLineup(lineup, { id: 11, role: 'member' })).toBe(
      true,
    );
  });

  it('denies non-invitee members on a private lineup', () => {
    const lineup = makePrivateLineup({
      createdBy: { id: 1, displayName: 'Op' },
      invitees: [{ id: 10, displayName: 'A', steamLinked: false }],
    });
    expect(canParticipateInLineup(lineup, { id: 99, role: 'member' })).toBe(
      false,
    );
  });

  it('treats an absent invitees list as an empty list', () => {
    const lineup = {
      visibility: 'private',
      createdBy: { id: 1, displayName: 'Op' },
    } as unknown as LineupShape;
    expect(canParticipateInLineup(lineup, { id: 7, role: 'member' })).toBe(
      false,
    );
  });
});
