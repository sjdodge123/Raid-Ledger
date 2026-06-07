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
import { ChannelBindingsService } from './services/channel-bindings.service';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Channel Bindings CRUD — create and read', () => {
  it('should create a channel binding and persist to DB', async () => {
    const db = testApp.db;

    const [result] = await db
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

    const [readBack] = await db
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
    const db = testApp.db;

    await db.insert(schema.channelBindings).values({
      guildId: '111222333444',
      channelId: '999000111222',
      channelType: 'text',
      bindingPurpose: 'game-announcements',
      gameId: testApp.seed.game.id,
      config: {},
    });

    const rows = await db
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
});

describe('Channel Bindings CRUD — upsert', () => {
  it('should handle upsert (onConflictDoUpdate) for same guild+channel+series', async () => {
    const db = testApp.db;
    const seriesId = '550e8400-e29b-41d4-a716-446655440000';

    await db.insert(schema.channelBindings).values({
      guildId: '111222333444',
      channelId: '555666777888',
      channelType: 'text',
      bindingPurpose: 'game-announcements',
      gameId: testApp.seed.game.id,
      recurrenceGroupId: seriesId,
      config: {},
    });

    const [upserted] = await db
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

    const allRows = await db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.guildId, '111222333444'));

    expect(allRows.length).toBe(1);
  });
});

describe('Channel Bindings CRUD — delete', () => {
  it('should delete a channel binding', async () => {
    const db = testApp.db;

    const [created] = await db
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

    const deleted = await db
      .delete(schema.channelBindings)
      .where(eq(schema.channelBindings.id, created.id))
      .returning();

    expect(deleted.length).toBe(1);

    const remaining = await db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, created.id));

    expect(remaining.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ROK-1351: series-level dual binding (voice host channel + text announce
// channel). These tests exercise the real ChannelBindingsService.bind() path
// — the same code the /bind slash command calls — NOT raw DB inserts, so they
// reproduce the production clobber bug in cleanupSeriesBindings.
//
// On origin/main these FAIL: cleanupSeriesBindings deletes ALL rows for
// (guildId, recurrenceGroupId) regardless of channelType, so the second bind
// of a series wipes the first slot's row. The fix is slot-scoped cleanup
// (only delete rows of the SAME channelType being re-bound).
// ---------------------------------------------------------------------------
describe('ROK-1351 — series dual binding (voice host + text announce)', () => {
  const GUILD = '900100200300';
  const SERIES = 'aaaaaaaa-1111-2222-3333-444444444444';
  const TEXT_CHANNEL = '700070007000';
  const VOICE_CHANNEL = '800080008000';

  function svc(): ChannelBindingsService {
    return testApp.app.get(ChannelBindingsService);
  }

  /** All channel_bindings rows for the dual-binding test series. */
  async function seriesRows() {
    return testApp.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.recurrenceGroupId, SERIES));
  }

  // AC1 / AC3: a voice (host) bind and a text (announce) bind coexist after
  // sequential binds; binding the second slot does NOT delete the first.
  it('AC1: voice + text series rows coexist after sequential binds', async () => {
    const service = svc();

    // First bind: text announce slot for the series.
    await service.bind(
      GUILD,
      TEXT_CHANNEL,
      'text',
      'game-announcements',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    // Second bind: voice host slot for the SAME series.
    await service.bind(
      GUILD,
      VOICE_CHANNEL,
      'voice',
      'game-voice-monitor',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    const rows = await seriesRows();
    // Both slot rows must survive. On main, the voice bind clobbers the text
    // row, so this is length 1 (FAILS).
    expect(rows.length).toBe(2);

    const byType = Object.fromEntries(rows.map((r) => [r.channelType, r]));
    expect(byType.text?.channelId).toBe(TEXT_CHANNEL);
    expect(byType.voice?.channelId).toBe(VOICE_CHANNEL);

    // The resolution layer must surface each slot independently.
    expect(await service.getChannelForSeries(GUILD, SERIES)).toBe(TEXT_CHANNEL);
    expect(await service.getVoiceChannelForSeries(GUILD, SERIES)).toBe(
      VOICE_CHANNEL,
    );
  });

  it('AC3: binding the voice slot does not delete the existing text slot', async () => {
    const service = svc();

    await service.bind(
      GUILD,
      TEXT_CHANNEL,
      'text',
      'game-announcements',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    const { replacedChannelIds } = await service.bind(
      GUILD,
      VOICE_CHANNEL,
      'voice',
      'game-voice-monitor',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    // Binding the voice slot must NOT report the text channel as replaced —
    // it's a different slot. On main, cleanupSeriesBindings deletes the text
    // row and returns it here (FAILS).
    expect(replacedChannelIds).not.toContain(TEXT_CHANNEL);

    // The text announce row must still resolve.
    expect(await service.getChannelForSeries(GUILD, SERIES)).toBe(TEXT_CHANNEL);
  });

  it('AC3 (reverse): binding the text slot does not delete the existing voice slot', async () => {
    const service = svc();

    // Voice first this time.
    await service.bind(
      GUILD,
      VOICE_CHANNEL,
      'voice',
      'game-voice-monitor',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    const { replacedChannelIds } = await service.bind(
      GUILD,
      TEXT_CHANNEL,
      'text',
      'game-announcements',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    expect(replacedChannelIds).not.toContain(VOICE_CHANNEL);
    expect(await service.getVoiceChannelForSeries(GUILD, SERIES)).toBe(
      VOICE_CHANNEL,
    );

    const rows = await seriesRows();
    expect(rows.length).toBe(2);
  });

  // AC5: rebinding the SAME slot to a NEW channel replaces the prior same-slot
  // row, reports it in replacedChannelIds, and leaves the OTHER slot untouched.
  it('AC5: rebinding the same (voice) slot replaces the prior same-slot row and reports it', async () => {
    const service = svc();
    const NEW_VOICE_CHANNEL = '810081008100';

    // Establish both slots.
    await service.bind(
      GUILD,
      TEXT_CHANNEL,
      'text',
      'game-announcements',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );
    await service.bind(
      GUILD,
      VOICE_CHANNEL,
      'voice',
      'game-voice-monitor',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    // Rebind the voice slot to a different voice channel.
    const { replacedChannelIds } = await service.bind(
      GUILD,
      NEW_VOICE_CHANNEL,
      'voice',
      'game-voice-monitor',
      testApp.seed.game.id,
      undefined,
      SERIES,
    );

    // The prior voice channel was replaced and is reported.
    expect(replacedChannelIds).toContain(VOICE_CHANNEL);
    // The text slot is a DIFFERENT slot and must NOT be reported as replaced.
    // On main, cleanupSeriesBindings deletes the text row too and reports it
    // here (FAILS).
    expect(replacedChannelIds).not.toContain(TEXT_CHANNEL);

    // Exactly two rows remain: new voice + untouched text.
    const rows = await seriesRows();
    expect(rows.length).toBe(2);
    expect(await service.getVoiceChannelForSeries(GUILD, SERIES)).toBe(
      NEW_VOICE_CHANNEL,
    );
    expect(await service.getChannelForSeries(GUILD, SERIES)).toBe(TEXT_CHANNEL);
  });
});

describe('Channel Bindings CRUD — FK cascade', () => {
  it('should cascade set null when referenced game is deleted', async () => {
    const db = testApp.db;

    const [tempGame] = await db
      .insert(schema.games)
      .values({
        name: 'Temp Game',
        slug: 'temp-game',
        igdbId: null,
      })
      .returning();

    const [binding] = await db
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

    await db.delete(schema.games).where(eq(schema.games.id, tempGame.id));

    const [updated] = await db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, binding.id));

    expect(updated).toBeDefined();
    expect(updated.gameId).toBeNull();
  });
});
