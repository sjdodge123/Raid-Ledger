/**
 * Tests for ROK-914: buildRosterWithAssignments returns empty roster
 * instead of 404 when event doesn't exist.
 */
import {
  buildRosterWithAssignments,
  partitionAssignments,
} from './signups-roster-query.helpers';

function createMockDbForRoster(eventRows: unknown[], signupRows: unknown[]) {
  const limitMock = jest.fn().mockResolvedValue(eventRows);
  const orderByMock = jest.fn().mockResolvedValue(signupRows);

  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: limitMock,
          orderBy: orderByMock,
        }),
        leftJoin: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: orderByMock,
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof buildRosterWithAssignments>[0];
}

/** Minimal valid signup row shape for partitionAssignments tests. */
function makeSignupRow(
  overrides: Partial<{
    signupId: number;
    userId: number | null;
    assignment: Record<string, unknown> | null;
  }> = {},
) {
  const { signupId = 1, userId = 10, assignment = null } = overrides;
  return {
    event_signups: {
      id: signupId,
      eventId: 5,
      userId,
      discordUserId: null,
      discordUsername: null,
      discordAvatarHash: null,
      note: null,
      signedUpAt: new Date('2026-01-01T12:00:00Z'),
      characterId: null,
      confirmationStatus: 'confirmed',
      status: 'signed_up',
      preferredRoles: null,
      attendanceStatus: null,
      attendanceRecordedAt: null,
      roachedOutAt: null,
    },
    users: userId
      ? { id: userId, username: 'testuser', discordId: 'disc-1', avatar: null, customAvatarUrl: null }
      : null,
    characters: null,
    roster_assignments: assignment
      ? { id: 1, signupId, eventId: 5, role: 'player', position: 1, isOverride: 0, ...assignment }
      : null,
  };
}

describe('buildRosterWithAssignments (ROK-914)', () => {
  it('returns empty roster when event does not exist', async () => {
    const db = createMockDbForRoster([], []);

    const result = await buildRosterWithAssignments(db, 999);

    expect(result).toEqual({
      eventId: 999,
      pool: [],
      assignments: [],
      slots: undefined,
    });
  });

  it('does not throw NotFoundException for non-existent event', async () => {
    const db = createMockDbForRoster([], []);

    await expect(buildRosterWithAssignments(db, 0)).resolves.not.toThrow();
  });

  it('returns eventId 0 in the result when called with ID 0', async () => {
    const db = createMockDbForRoster([], []);

    const result = await buildRosterWithAssignments(db, 0);

    expect(result.eventId).toBe(0);
  });

  it('returns slots and empty pool/assignments when event exists but has no signups', async () => {
    const eventRow = {
      id: 42,
      slotConfig: { type: 'generic', player: 8, bench: 3 },
      maxAttendees: null,
      gameId: null,
    };
    const db = createMockDbForRoster([eventRow], []);

    const result = await buildRosterWithAssignments(db, 42);

    expect(result.eventId).toBe(42);
    expect(result.pool).toEqual([]);
    expect(result.assignments).toEqual([]);
    expect(result.slots).toEqual({ player: 8, bench: 3 });
  });

  it('resolves MMO slots from event slotConfig when event exists', async () => {
    const eventRow = {
      id: 7,
      slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 10, bench: 2 },
      maxAttendees: null,
      gameId: null,
    };
    const db = createMockDbForRoster([eventRow], []);

    const result = await buildRosterWithAssignments(db, 7);

    expect(result.slots).toMatchObject({ tank: 2, healer: 4, dps: 10, bench: 2 });
  });

  it('populates pool with unassigned signups when event exists', async () => {
    const eventRow = {
      id: 5,
      slotConfig: { type: 'generic', player: 10, bench: 5 },
      maxAttendees: null,
      gameId: null,
    };
    const signupRows = [
      makeSignupRow({ signupId: 1, userId: 10, assignment: null }),
      makeSignupRow({ signupId: 2, userId: 11, assignment: null }),
    ];
    const db = createMockDbForRoster([eventRow], signupRows);

    const result = await buildRosterWithAssignments(db, 5);

    expect(result.pool).toHaveLength(2);
    expect(result.assignments).toHaveLength(0);
  });

  it('populates assignments and pool correctly when event has mixed signups', async () => {
    const eventRow = {
      id: 5,
      slotConfig: { type: 'generic', player: 10, bench: 5 },
      maxAttendees: null,
      gameId: null,
    };
    const signupRows = [
      makeSignupRow({ signupId: 1, userId: 10, assignment: null }),
      makeSignupRow({
        signupId: 2,
        userId: 11,
        assignment: { id: 100, role: 'player', position: 1, isOverride: 0 },
      }),
    ];
    const db = createMockDbForRoster([eventRow], signupRows);

    const result = await buildRosterWithAssignments(db, 5);

    expect(result.pool).toHaveLength(1);
    expect(result.assignments).toHaveLength(1);
  });
});

describe('partitionAssignments (ROK-914)', () => {
  it('returns empty pool and assignments for empty input', () => {
    const { pool, assigned } = partitionAssignments([]);

    expect(pool).toEqual([]);
    expect(assigned).toEqual([]);
  });

  it('puts rows without roster_assignments into pool', () => {
    const rows = [
      makeSignupRow({ signupId: 1, assignment: null }),
      makeSignupRow({ signupId: 2, assignment: null }),
    ] as Parameters<typeof partitionAssignments>[0];

    const { pool, assigned } = partitionAssignments(rows);

    expect(pool).toHaveLength(2);
    expect(assigned).toHaveLength(0);
  });

  it('puts rows with roster_assignments into assigned', () => {
    const rows = [
      makeSignupRow({
        signupId: 1,
        assignment: { id: 10, role: 'tank', position: 1, isOverride: 0 },
      }),
      makeSignupRow({
        signupId: 2,
        assignment: { id: 11, role: 'healer', position: 1, isOverride: 0 },
      }),
    ] as Parameters<typeof partitionAssignments>[0];

    const { pool, assigned } = partitionAssignments(rows);

    expect(pool).toHaveLength(0);
    expect(assigned).toHaveLength(2);
  });

  it('correctly splits mixed rows into pool and assigned', () => {
    const rows = [
      makeSignupRow({ signupId: 1, assignment: null }),
      makeSignupRow({
        signupId: 2,
        assignment: { id: 20, role: 'dps', position: 1, isOverride: 0 },
      }),
      makeSignupRow({ signupId: 3, assignment: null }),
    ] as Parameters<typeof partitionAssignments>[0];

    const { pool, assigned } = partitionAssignments(rows);

    expect(pool).toHaveLength(2);
    expect(assigned).toHaveLength(1);
  });

  it('preserves signupId in both pool and assigned rows', () => {
    const rows = [
      makeSignupRow({ signupId: 99, assignment: null }),
      makeSignupRow({
        signupId: 100,
        assignment: { id: 50, role: 'bench', position: 2, isOverride: 0 },
      }),
    ] as Parameters<typeof partitionAssignments>[0];

    const { pool, assigned } = partitionAssignments(rows);

    expect(pool[0].signupId).toBe(99);
    expect(assigned[0].signupId).toBe(100);
  });

  it('assigned row slot matches the roster_assignments role', () => {
    const rows = [
      makeSignupRow({
        signupId: 1,
        assignment: { id: 5, role: 'healer', position: 3, isOverride: 0 },
      }),
    ] as Parameters<typeof partitionAssignments>[0];

    const { assigned } = partitionAssignments(rows);

    expect(assigned[0].slot).toBe('healer');
  });

  it('pool row slot is null when no assignment', () => {
    const rows = [
      makeSignupRow({ signupId: 1, assignment: null }),
    ] as Parameters<typeof partitionAssignments>[0];

    const { pool } = partitionAssignments(rows);

    expect(pool[0].slot).toBeNull();
  });
});
