/**
 * Unit tests for voice-attendance-populate.helpers (ROK-1940 D3).
 * The auto-populate writer stamps `attendance_source = 'voice'` on every
 * signup row it marks, so later reclassification can tell its marks apart
 * from an organiser's.
 */
import { autoPopulateAttendance } from './voice-attendance-populate.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

const logger = { log: jest.fn(), warn: jest.fn() };

function session(
  overrides: Partial<{
    discordUserId: string;
    userId: number | null;
    classification: string;
  }>,
) {
  return {
    id: 1,
    eventId: 7,
    discordUserId: 'd-1',
    userId: 11,
    classification: 'full',
    ...overrides,
  };
}

describe('autoPopulateAttendance — provenance (ROK-1940)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it("writes attendance_source 'voice' alongside every status it sets", async () => {
    mockDb.where.mockResolvedValueOnce([
      session({ discordUserId: 'd-1', userId: 11, classification: 'late' }),
      session({ discordUserId: 'd-2', userId: 12, classification: 'no_show' }),
    ]);

    await autoPopulateAttendance(mockDb as never, 7, logger);

    // attended + no_show, each via discordUserId and via userId
    expect(mockDb.set).toHaveBeenCalledTimes(4);
    const payloads = mockDb.set.mock.calls.map((call: unknown[]) => call[0]);
    for (const payload of payloads) {
      expect(payload).toEqual(
        expect.objectContaining({ attendanceSource: 'voice' }),
      );
    }
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attendanceStatus: 'attended' }),
        expect.objectContaining({ attendanceStatus: 'no_show' }),
      ]),
    );
  });

  it('writes nothing when the event has no classified sessions', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    await autoPopulateAttendance(mockDb as never, 7, logger);

    expect(mockDb.set).not.toHaveBeenCalled();
  });
});
