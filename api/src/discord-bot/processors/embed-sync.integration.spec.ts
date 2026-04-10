/**
 * Integration tests for embed-sync multi-message tracking (ROK-1029).
 *
 * Verifies that findTrackedMessage(s) returns ALL discord_event_messages
 * rows for an event+guild pair, not just the first one. This is critical
 * for forwarded/unfurled embeds that create a second tracking row in a
 * different channel.
 *
 * These tests are TDD-first: they WILL FAIL against the current code
 * because findTrackedMessage() uses LIMIT 1 and returns a single record.
 * The dev agent must rename the function to findTrackedMessages() and
 * change it to return an array.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { findTrackedMessage } from './embed-sync.helpers';

const TEST_GUILD_ID = 'guild-1029';
const CHANNEL_A = 'channel-a';
const CHANNEL_B = 'channel-b';
const MESSAGE_A = 'msg-aaa';
const MESSAGE_B = 'msg-bbb';

/** Insert an event into the DB and return its id. */
async function insertEvent(testApp: TestApp): Promise<number> {
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'ROK-1029 Test Event',
      duration: [now, later],
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
    })
    .returning();
  return event.id;
}

/** Insert a discord_event_messages tracking row. */
async function insertTrackedMessage(
  testApp: TestApp,
  eventId: number,
  guildId: string,
  channelId: string,
  messageId: string,
) {
  await testApp.db.insert(schema.discordEventMessages).values({
    eventId,
    guildId,
    channelId,
    messageId,
    embedState: 'posted',
  });
}

function describeMultiMessageSync() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  describe('AC2: findTrackedMessages returns all records for event+guild', () => {
    it('returns an array with both records when two channels track the same event', async () => {
      // Arrange: create event with two tracking rows in different channels
      const eventId = await insertEvent(testApp);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_A, MESSAGE_A);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_B, MESSAGE_B);

      // Act: call the helper (currently findTrackedMessage, should become findTrackedMessages)
      const result = await findTrackedMessage(testApp.db, eventId, TEST_GUILD_ID);

      // Assert: must be an array of 2 records
      // This WILL FAIL because findTrackedMessage returns a single object, not an array
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(2);
    });

    it('includes both channel IDs in the returned records', async () => {
      // Arrange
      const eventId = await insertEvent(testApp);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_A, MESSAGE_A);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_B, MESSAGE_B);

      // Act
      const result = await findTrackedMessage(testApp.db, eventId, TEST_GUILD_ID);

      // Assert: both channel IDs must be present in the result set
      // This WILL FAIL because result is a single record, not an array
      const records = result as unknown as Array<{ channelId: string }>;
      const channelIds = records.map((r) => r.channelId).sort();
      expect(channelIds).toEqual([CHANNEL_A, CHANNEL_B]);
    });
  });

  describe('AC4: single-channel regression', () => {
    it('returns an array of 1 record when only one channel tracks the event', async () => {
      // Arrange: single tracking row
      const eventId = await insertEvent(testApp);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_A, MESSAGE_A);

      // Act
      const result = await findTrackedMessage(testApp.db, eventId, TEST_GUILD_ID);

      // Assert: must be an array of 1 record, not a bare object
      // This WILL FAIL because findTrackedMessage returns a single object
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(1);
    });

    it('returns an empty array when no tracking rows exist', async () => {
      // Arrange: event exists but no tracking rows
      const eventId = await insertEvent(testApp);

      // Act
      const result = await findTrackedMessage(testApp.db, eventId, TEST_GUILD_ID);

      // Assert: must be an empty array, not null
      // This WILL FAIL because findTrackedMessage returns null for no records
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(0);
    });
  });

  describe('AC1: multi-message sync updates all copies', () => {
    it('all tracked message IDs are queryable for the same event+guild', async () => {
      // Arrange: create event with two tracking rows (simulating original + forwarded embed)
      const eventId = await insertEvent(testApp);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_A, MESSAGE_A);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_B, MESSAGE_B);

      // Act: query all tracked messages
      const result = await findTrackedMessage(testApp.db, eventId, TEST_GUILD_ID);

      // Assert: the sync processor needs all message IDs to update each embed
      // This WILL FAIL because findTrackedMessage only returns one record
      const records = result as unknown as Array<{ messageId: string }>;
      const messageIds = records.map((r) => r.messageId).sort();
      expect(messageIds).toEqual([MESSAGE_A, MESSAGE_B]);
    });

    it('does not return records from a different guild', async () => {
      // Arrange: two tracking rows in different guilds
      const eventId = await insertEvent(testApp);
      await insertTrackedMessage(testApp, eventId, TEST_GUILD_ID, CHANNEL_A, MESSAGE_A);
      await insertTrackedMessage(testApp, eventId, 'other-guild', CHANNEL_B, MESSAGE_B);

      // Act: query for TEST_GUILD_ID only
      const result = await findTrackedMessage(testApp.db, eventId, TEST_GUILD_ID);

      // Assert: must return only the record for TEST_GUILD_ID, as an array of 1
      // This WILL FAIL because findTrackedMessage returns a single object, not an array
      expect(Array.isArray(result)).toBe(true);
      const records = result as unknown as Array<{ guildId: string }>;
      expect(records.length).toBe(1);
      expect(records[0].guildId).toBe(TEST_GUILD_ID);
    });
  });
}

describe('Embed Sync Multi-Message Tracking (integration)', () =>
  describeMultiMessageSync());
