/**
 * Unit tests for insertSignupRow() — ROK-985.
 *
 * AC: insertSignupRow() populates discordUserId when a discordId param is passed.
 * Currently the function does NOT accept a discordId param, so these tests
 * will FAIL until the implementation is updated.
 */
import { insertSignupRow } from './signups-signup.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../common/testing/drizzle-mock';

describe('insertSignupRow', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('includes discordUserId in insert values when discordId is provided', async () => {
    const fakeRow = { id: 1, eventId: 10, userId: 5 };
    mockDb.returning.mockResolvedValueOnce([fakeRow]);

    await insertSignupRow(
      mockDb as never,
      10,
      5,
      undefined,
      '123456789',
    );

    // The .values() call should include discordUserId
    const valuesCall = mockDb.values.mock.calls[0][0];
    expect(valuesCall).toHaveProperty('discordUserId', '123456789');
  });

  it('does NOT include discordUserId when discordId is omitted', async () => {
    const fakeRow = { id: 2, eventId: 10, userId: 6 };
    mockDb.returning.mockResolvedValueOnce([fakeRow]);

    await insertSignupRow(mockDb as never, 10, 6);

    const valuesCall = mockDb.values.mock.calls[0][0];
    expect(valuesCall).not.toHaveProperty('discordUserId');
  });
});
