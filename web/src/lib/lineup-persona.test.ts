/**
 * Tests for getLineupPersona (ROK-1209).
 *
 * Persona resolution is the spine of every hero/copy decision: if this is wrong,
 * every downstream copy variant is wrong. The five resolutions plus the two
 * spec edge cases (organizer-who-is-creator, uninvited-on-public-lineup) are
 * each pinned here so any future logic drift fails loudly.
 */
import { describe, expect, it } from 'vitest';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { getLineupPersona, type Persona } from './lineup-persona';

interface UserShape {
  id: number;
  role?: string;
}

type LineupShape = Pick<
  LineupDetailResponseDto,
  'visibility' | 'createdBy' | 'invitees'
>;

function makeLineup(overrides: Partial<LineupShape> = {}): LineupShape {
  return {
    visibility: 'public',
    createdBy: { id: 1, displayName: 'Owner' },
    invitees: [],
    ...overrides,
  };
}

describe('getLineupPersona — five primary resolutions', () => {
  it("returns 'invitee-not-acted' for a public-lineup invitee who hasn't acted", () => {
    const lineup = makeLineup({ visibility: 'public' });
    const user: UserShape = { id: 99, role: 'member' };
    expect(getLineupPersona(lineup, user, false)).toBe<Persona>('invitee-not-acted');
  });

  it("returns 'invitee-acted' for a public-lineup invitee who has acted", () => {
    const lineup = makeLineup({ visibility: 'public' });
    const user: UserShape = { id: 99, role: 'member' };
    expect(getLineupPersona(lineup, user, true)).toBe<Persona>('invitee-acted');
  });

  it("returns 'organizer' when the user is operator AND the lineup creator", () => {
    const lineup = makeLineup({
      createdBy: { id: 7, displayName: 'Boss' },
    });
    const user: UserShape = { id: 7, role: 'operator' };
    expect(getLineupPersona(lineup, user, false)).toBe<Persona>('organizer');
  });

  it("returns 'admin' when the user is admin but NOT the creator", () => {
    const lineup = makeLineup({
      createdBy: { id: 1, displayName: 'Owner' },
    });
    const user: UserShape = { id: 99, role: 'admin' };
    expect(getLineupPersona(lineup, user, false)).toBe<Persona>('admin');
  });

  it("returns 'uninvited' on a private lineup with a non-invitee non-admin user", () => {
    const lineup = makeLineup({
      visibility: 'private',
      createdBy: { id: 1, displayName: 'Owner' },
      invitees: [],
    });
    const user: UserShape = { id: 99, role: 'member' };
    expect(getLineupPersona(lineup, user, false)).toBe<Persona>('uninvited');
  });
});

describe('getLineupPersona — operator/admin precedence (spec edge case #1, #2)', () => {
  it('operator-who-is-creator is organizer even when hasActed=true', () => {
    const lineup = makeLineup({ createdBy: { id: 7, displayName: 'Boss' } });
    const user: UserShape = { id: 7, role: 'operator' };
    expect(getLineupPersona(lineup, user, true)).toBe<Persona>('organizer');
  });

  it('admin who is also the creator returns organizer (creator wins over admin)', () => {
    const lineup = makeLineup({ createdBy: { id: 7, displayName: 'Boss' } });
    const user: UserShape = { id: 7, role: 'admin' };
    expect(getLineupPersona(lineup, user, false)).toBe<Persona>('organizer');
  });

  it('admin who has acted but is NOT creator stays admin (operator copy wins)', () => {
    const lineup = makeLineup({ createdBy: { id: 1, displayName: 'Owner' } });
    const user: UserShape = { id: 99, role: 'admin' };
    expect(getLineupPersona(lineup, user, true)).toBe<Persona>('admin');
  });
});

describe('getLineupPersona — public/private gating', () => {
  it("public lineup with anonymous user is 'invitee-not-acted' (not uninvited)", () => {
    const lineup = makeLineup({ visibility: 'public' });
    expect(getLineupPersona(lineup, null, false)).toBe<Persona>('invitee-not-acted');
  });

  it("private lineup with explicit invitee returns 'invitee-not-acted' / 'invitee-acted'", () => {
    const lineup = makeLineup({
      visibility: 'private',
      invitees: [{ id: 99, displayName: 'Friend', steamLinked: false }],
    });
    const user: UserShape = { id: 99, role: 'member' };
    expect(getLineupPersona(lineup, user, false)).toBe<Persona>('invitee-not-acted');
    expect(getLineupPersona(lineup, user, true)).toBe<Persona>('invitee-acted');
  });

  it("admin viewing a private lineup returns 'admin' (overrides uninvited)", () => {
    const lineup = makeLineup({
      visibility: 'private',
      createdBy: { id: 1, displayName: 'Owner' },
      invitees: [],
    });
    const user: UserShape = { id: 99, role: 'admin' };
    expect(getLineupPersona(lineup, user, false)).toBe<Persona>('admin');
  });
});
