/**
 * ROK-2292 — shared seams for the forum starter-card integration specs.
 * `stubStarterSync` reports the bot in a guild (so `EventForumStarterCards
 * .record` writes its row) and records embed-sync enqueues instead of
 * queueing them; `starterRows` reads an event's forum starter rows
 * (`channel_id = message_id`). Excluded from `nest build` by the
 * `*.test-fixtures.ts` pattern.
 */
import { and, eq } from 'drizzle-orm';
import type { TestApp } from '../../../common/testing/test-app';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { EmbedSyncQueueService } from '../../../discord-bot/queues/embed-sync.queue';
import { forumStarterRowsOnly } from '../../../discord-bot/services/event-message-rows.helpers';
import * as schema from '../../../drizzle/schema';
import { FAKE_DISCORD_GUILD } from './hub-forum-discord.test-fixtures';

/** Bot connected in the fake guild; embed-sync enqueues are spied, not run. */
export function stubStarterSync(testApp: TestApp) {
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuildId').mockReturnValue(FAKE_DISCORD_GUILD);
  const enqueue = jest
    .spyOn(testApp.app.get(EmbedSyncQueueService), 'enqueue')
    .mockResolvedValue(undefined);
  return { enqueue };
}

/** The event's forum starter rows as `{ channelId, messageId }`. */
export async function starterRows(testApp: TestApp, eventId: number) {
  const t = schema.discordEventMessages;
  return testApp.db
    .select({ channelId: t.channelId, messageId: t.messageId })
    .from(t)
    .where(and(forumStarterRowsOnly(), eq(t.eventId, eventId)));
}
