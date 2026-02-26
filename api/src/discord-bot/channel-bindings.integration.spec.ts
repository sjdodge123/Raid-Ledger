/**
 * Channel Bindings Integration Tests
 *
 * Verifies channel bindings CRUD against a real PostgreSQL database.
 * Tests at the service level since the controller requires a live Discord bot.
 * This was a key gap in ROK-293: binding game references required a JOIN
 * that was invisible to mocked tests.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

describe('Channel Bindings CRUD (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db as never);
  });

  it('should create a channel binding and persist to DB', async () => {
    const db = testApp.db as never;

    // Insert a binding directly via DB (simulating what the service does)
    const [result] = await (db as typeof testApp.db)
      .insert(schema.channelBindings)
      .values({
        guildId: '111222333444',
        channelId: '555666777888',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId: testApp.seed.game.id,
        config: {},
      })
      .returning();

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.guildId).toBe('111222333444');
    expect(result.channelId).toBe('555666777888');
    expect(result.gameId).toBe(testApp.seed.game.id);

    // Read back from DB to verify persistence
    const [readBack] = await (db as typeof testApp.db)
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, result.id))
      .limit(1);

    expect(readBack).toBeDefined();
    expect(readBack.guildId).toBe('111222333444');
    expect(readBack.bindingPurpose).toBe('game-announcements');
    expect(readBack.gameId).toBe(testApp.seed.game.id);
  });

  it('should join game data when querying bindings with game references', async () => {
    const db = testApp.db as never;

    // Create a binding referencing the seeded game
    await (db as typeof testApp.db).insert(schema.channelBindings).values({
      guildId: '111222333444',
      channelId: '999000111222',
      channelType: 'text',
      bindingPurpose: 'game-announcements',
      gameId: testApp.seed.game.id,
      config: {},
    });

    // Query with game join — this is the pattern that failed in ROK-293
    const rows = await (db as typeof testApp.db)
      .select({
        bindingId: schema.channelBindings.id,
        channelId: schema.channelBindings.channelId,
        gameName: schema.games.name,
        gameId: schema.channelBindings.gameId,
      })
      .from(schema.channelBindings)
      .innerJoin(
        schema.games,
        eq(schema.channelBindings.gameId, schema.games.id),
      );

    expect(rows.length).toBe(1);
    expect(rows[0].gameName).toBe('Test Game');
    expect(rows[0].gameId).toBe(testApp.seed.game.id);
  });

  it('should handle upsert (onConflictDoUpdate) for same guild+channel+series', async () => {
    const db = testApp.db as never;
    const typedDb = db as typeof testApp.db;
    const seriesId = '550e8400-e29b-41d4-a716-446655440000';

    // Create initial binding with a recurrence group ID
    await typedDb.insert(schema.channelBindings).values({
      guildId: '111222333444',
      channelId: '555666777888',
      channelType: 'text',
      bindingPurpose: 'game-announcements',
      gameId: testApp.seed.game.id,
      recurrenceGroupId: seriesId,
      config: {},
    });

    // Upsert — same guild+channel+series should update (not insert)
    const [upserted] = await typedDb
      .insert(schema.channelBindings)
      .values({
        guildId: '111222333444',
        channelId: '555666777888',
        channelType: 'text',
        bindingPurpose: 'game-voice-monitor',
        gameId: testApp.seed.game.id,
        recurrenceGroupId: seriesId,
        config: { minPlayers: 3 },
      })
      .onConflictDoUpdate({
        target: [
          schema.channelBindings.guildId,
          schema.channelBindings.channelId,
          schema.channelBindings.recurrenceGroupId,
        ],
        set: {
          bindingPurpose: 'game-voice-monitor',
          config: { minPlayers: 3 },
          updatedAt: new Date(),
        },
      })
      .returning();

    expect(upserted.bindingPurpose).toBe('game-voice-monitor');
    expect(upserted.config).toMatchObject({ minPlayers: 3 });

    // Should still be only one row for this guild
    const allRows = await typedDb
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.guildId, '111222333444'));

    expect(allRows.length).toBe(1);
  });

  it('should delete a channel binding', async () => {
    const db = testApp.db as never;
    const typedDb = db as typeof testApp.db;

    const [created] = await typedDb
      .insert(schema.channelBindings)
      .values({
        guildId: '111222333444',
        channelId: '999000111222',
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: null,
        config: {},
      })
      .returning();

    // Delete
    const deleted = await typedDb
      .delete(schema.channelBindings)
      .where(eq(schema.channelBindings.id, created.id))
      .returning();

    expect(deleted.length).toBe(1);

    // Verify gone
    const remaining = await typedDb
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, created.id));

    expect(remaining.length).toBe(0);
  });

  it('should cascade set null when referenced game is deleted', async () => {
    const db = testApp.db as never;
    const typedDb = db as typeof testApp.db;

    // Create a second game to delete (don't delete seeded game)
    const [tempGame] = await typedDb
      .insert(schema.games)
      .values({
        name: 'Temp Game',
        slug: 'temp-game',
        igdbId: null,
      })
      .returning();

    // Create binding referencing temp game
    const [binding] = await typedDb
      .insert(schema.channelBindings)
      .values({
        guildId: '111222333444',
        channelId: '333444555666',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId: tempGame.id,
        config: {},
      })
      .returning();

    // Delete the game — FK should set gameId to null
    await typedDb.delete(schema.games).where(eq(schema.games.id, tempGame.id));

    // Verify binding still exists but gameId is null
    const [updated] = await typedDb
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, binding.id));

    expect(updated).toBeDefined();
    expect(updated.gameId).toBeNull();
  });
});
