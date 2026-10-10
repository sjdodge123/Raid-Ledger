/**
 * ROK-1759 — a Discord sign-in / account link stamps `guild_member_seen_at`
 * when the bot confirms guild membership (join-before-signup gap: the
 * GuildMemberAdd stamp matched no row because the account did not exist yet).
 *
 * Emits the REAL `AUTH_EVENTS.DISCORD_LOGIN` through the app's event bus —
 * `emitAsync` awaits every `@OnEvent` handler, so the stamp is observable
 * without polling — and spies only the bot's network membership lookup.
 */
import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { AUTH_EVENTS, type DiscordLoginPayload } from '../../auth/auth.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { isGuildMemberSeen } from '../../notifications/discord-notification-deactivate.helpers';
import { defined } from '../../common/testing/narrow';

let testApp: TestApp;
let memberSpy: jest.SpyInstance | undefined;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  memberSpy?.mockRestore();
  memberSpy = undefined;
  testApp.seed = await truncateAllTables(testApp.db);
});

type UserRow = typeof schema.users.$inferSelect;

/** A fresh OAuth account: created after the user joined, so never stamped. */
async function createUnstampedUser(discordId: string): Promise<UserRow> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId, username: `u-${discordId}`, role: 'member' })
    .returning();
  return defined(user, `inserted user ${discordId}`);
}

async function seenAt(userId: number): Promise<Date | null> {
  const row = await testApp.db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  return defined(row, `user ${userId}`).guildMemberSeenAt;
}

/** Sign in through the event bus with the bot lookup answering `answer`. */
async function signIn(
  userId: number,
  discordId: string,
  answer: boolean | Error,
): Promise<void> {
  const bot = testApp.app.get(DiscordBotClientService);
  const spy = jest.spyOn(bot, 'isGuildMember');
  memberSpy = spy;
  if (answer instanceof Error) spy.mockRejectedValue(answer);
  else spy.mockResolvedValue(answer);
  await testApp.app.get(EventEmitter2).emitAsync(AUTH_EVENTS.DISCORD_LOGIN, {
    userId,
    discordId,
  } satisfies DiscordLoginPayload);
  expect(spy).toHaveBeenCalledWith(discordId);
}

describe('Discord sign-in stamps guild_member_seen_at (ROK-1759)', () => {
  it('stamps a current guild member, making them a 50278-deactivation candidate', async () => {
    const user = await createUnstampedUser('discord-joined-first');
    await signIn(user.id, 'discord-joined-first', true);
    expect(await seenAt(user.id)).toBeInstanceOf(Date);
    expect(await isGuildMemberSeen(testApp.db, user.id)).toBe(true);
  });

  it('leaves a non-member (OAuth guest) unstamped', async () => {
    const user = await createUnstampedUser('discord-guest');
    await signIn(user.id, 'discord-guest', false);
    expect(await seenAt(user.id)).toBeNull();
    expect(await isGuildMemberSeen(testApp.db, user.id)).toBe(false);
  });

  it('leaves the row unstamped when the bot lookup fails', async () => {
    const user = await createUnstampedUser('discord-bot-offline');
    await signIn(user.id, 'discord-bot-offline', new Error('bot offline'));
    expect(await seenAt(user.id)).toBeNull();
  });
});
