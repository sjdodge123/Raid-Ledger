/**
 * Tests for ROK-914: buildRosterWithAssignments returns empty roster
 * instead of 404 when event doesn't exist.
 */
import { buildRosterWithAssignments } from './signups-roster-query.helpers';

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
});
