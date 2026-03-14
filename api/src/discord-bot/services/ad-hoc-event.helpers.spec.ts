import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { createAdHocEventRow } from './ad-hoc-event.helpers';

describe('createAdHocEventRow — title resolution (ROK-817)', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('uses DB game name when gameId is resolved', async () => {
    // First query: resolveGameName (select→from→where→limit)
    db.limit.mockResolvedValueOnce([{ name: 'WoW Classic TBC' }]);
    // Second query: insert event (insert→values→returning)
    db.returning.mockResolvedValueOnce([{ id: 42 }]);

    await createAdHocEventRow(
      db as never,
      'binding-1',
      { gameId: 7 },
      1,
      'World of Warcraft Classic',
    );

    const insertedValues = db.values.mock.calls[0][0];
    expect(insertedValues.title).toBe('WoW Classic TBC — Quick Play');
  });

  it('falls back to Discord activity string when gameId is null', async () => {
    // No resolveGameName query — gameId is null
    // Insert event (insert→values→returning)
    db.returning.mockResolvedValueOnce([{ id: 43 }]);

    await createAdHocEventRow(
      db as never,
      'binding-1',
      { gameId: null },
      1,
      'Some Discord Activity',
    );

    const insertedValues = db.values.mock.calls[0][0];
    expect(insertedValues.title).toBe('Some Discord Activity — Quick Play');
  });

  it('uses "Gaming" when both gameId and resolvedGameName are absent', async () => {
    db.returning.mockResolvedValueOnce([{ id: 44 }]);

    await createAdHocEventRow(db as never, 'binding-1', { gameId: null }, 1);

    const insertedValues = db.values.mock.calls[0][0];
    expect(insertedValues.title).toBe('Gaming — Quick Play');
  });

  it('falls back to Discord string when DB lookup returns no match', async () => {
    // resolveGameName returns empty (game not found)
    db.limit.mockResolvedValueOnce([]);
    db.returning.mockResolvedValueOnce([{ id: 45 }]);

    await createAdHocEventRow(
      db as never,
      'binding-1',
      { gameId: 999 },
      1,
      'Unknown Discord Game',
    );

    const insertedValues = db.values.mock.calls[0][0];
    expect(insertedValues.title).toBe('Unknown Discord Game — Quick Play');
  });
});
