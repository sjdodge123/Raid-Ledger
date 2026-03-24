import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  createAdHocEventRow,
  findActiveScheduledEvent,
} from './ad-hoc-event.helpers';

/** Recursively extract string fragments from Drizzle SQL objects. */
function sqlToString(obj: unknown, depth = 0): string {
  if (depth > 15 || !obj) return '';
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj))
    return obj.map((v) => sqlToString(v, depth + 1)).join('');
  const record = obj as Record<string, unknown>;
  if (record.value && Array.isArray(record.value)) {
    return (record.value as unknown[])
      .map((v) => sqlToString(v, depth + 1))
      .join('');
  }
  if (record.queryChunks && Array.isArray(record.queryChunks)) {
    return (record.queryChunks as unknown[])
      .map((v) => sqlToString(v, depth + 1))
      .join('');
  }
  return '';
}

describe('findActiveScheduledEvent — sibling binding suppression (ROK-959)', () => {
  let db: MockDb;
  const now = new Date('2026-03-24T20:00:00Z');

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('includes channel_bindings subquery when channelId provided (AC1)', async () => {
    // AC1: When channelId is passed, the WHERE clause must include
    // a subquery referencing channel_bindings to match sibling
    // bindings on the same physical voice channel.
    db.limit.mockResolvedValueOnce([{ id: 77 }]);

    await findActiveScheduledEvent(
      db as never,
      'binding-A',
      10,
      now,
      'voice-channel-1',
    );

    const whereArg = db.where.mock.calls[0]?.[0];
    const sqlText = sqlToString(whereArg);
    expect(sqlText).toContain('channel_bindings');
  });

  it('does not leak across channels (AC2 — backward compat)', async () => {
    // AC2: When a different channelId is passed, no sibling match
    // should occur. With current code, channelId is ignored entirely,
    // so this verifies existing binding-only matching still works.
    db.limit.mockResolvedValueOnce([]);

    const result = await findActiveScheduledEvent(
      db as never,
      'binding-A',
      10,
      now,
      'voice-channel-999',
    );

    expect(result).toBeUndefined();
  });

  it('omits channel_bindings subquery when channelId absent (AC3)', async () => {
    // AC3: Without channelId, WHERE clause should NOT contain
    // channel_bindings — only match by bindingId/effectiveGameId.
    db.limit.mockResolvedValueOnce([{ id: 88 }]);

    await findActiveScheduledEvent(db as never, 'binding-A', 10, now);

    const whereArg = db.where.mock.calls[0]?.[0];
    const sqlText = sqlToString(whereArg);
    expect(sqlText).not.toContain('channel_bindings');
  });
});

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
