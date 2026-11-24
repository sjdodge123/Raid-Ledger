/**
 * ROK-2317 (integration): the post-event "Thanks for joining — finish your
 * setup" DM follows the recipient's Post-Event Follow-Ups
 * (`post_event_followup`) Discord switch. A PUG with no Raid Ledger account has
 * no switch, so it still gets the nudge (ruling Q3).
 *
 * Driven through the real `PostEventReminderService` reminder pass against
 * Postgres; only the bot transport (`isConnected` / `isGuildMember` /
 * `sendEmbedDM`) is stubbed.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ActiveEventCacheService } from '../events/active-event-cache.service';
import { resolveChannelPrefs } from './notification-mapping.helpers';
import { PostEventReminderService } from './post-event-reminder.service';

const ACCOUNT_DISCORD_ID = '231700000000000101';
const NO_ACCOUNT_DISCORD_ID = '231700000000000102';
const MINUTE = 60_000;

let testApp: TestApp;
let sendEmbedDM: jest.SpyInstance;
let isConnected: jest.SpyInstance;
let isGuildMember: jest.SpyInstance;

/** A PUG with an account, onboarding unfinished; `discord` sets the switch. */
async function seedAccountPug(discord: boolean | 'no-row'): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: ACCOUNT_DISCORD_ID,
        username: 'pug_2317',
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'pug user',
  );
  if (discord !== 'no-row') {
    const channelPrefs = resolveChannelPrefs({});
    channelPrefs.post_event_followup = {
      ...channelPrefs.post_event_followup,
      discord,
    };
    await testApp.db
      .insert(schema.userNotificationPreferences)
      .values({ userId: user.id, channelPrefs });
  }
  return user.id;
}

/** An event that ended 15 minutes ago — inside the reminder window. */
async function seedEndedEvent(): Promise<number> {
  const end = new Date(Date.now() - 15 * MINUTE);
  const start = new Date(end.getTime() - 60 * MINUTE);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Ended Raid 2317',
        creatorId: testApp.seed.adminUser.id,
        duration: [start, end] as [Date, Date],
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return event.id;
}

/** A PUG slot on the event: claimed by `userId`, or Discord-only. */
async function seedPugSlot(
  eventId: number,
  who: { userId: number } | { discordId: string },
): Promise<string> {
  const claimed = 'userId' in who;
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.pugSlots)
      .values({
        eventId,
        role: 'dps',
        status: claimed ? 'claimed' : 'accepted',
        createdBy: testApp.seed.adminUser.id,
        discordUserId: claimed ? ACCOUNT_DISCORD_ID : who.discordId,
        discordUsername: claimed ? 'pug_2317' : 'stranger_2317',
        claimedByUserId: claimed ? who.userId : null,
      })
      .returning({ id: schema.pugSlots.id }),
    'pug slot',
  );
  return slot.id;
}

/** Run one real reminder pass (cache primed so the early-out lets it in). */
async function runReminderPass(): Promise<void> {
  await testApp.app.get(ActiveEventCacheService, { strict: false }).refresh();
  const service = testApp.app.get(PostEventReminderService, { strict: false });
  await service['processPostEventReminders']();
}

/** Discord ids the post-event DM went to. */
function dmRecipients(): unknown[] {
  return sendEmbedDM.mock.calls.map((call: unknown[]) => call[0]);
}

/** Dedup rows written for a slot (the pass records every slot it handled). */
async function dedupRows(slotId: string): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.postEventRemindersSent.pugSlotId })
    .from(schema.postEventRemindersSent)
    .where(eq(schema.postEventRemindersSent.pugSlotId, slotId));
  return rows.length;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  const client = testApp.app.get(DiscordBotClientService, { strict: false });
  isConnected = jest.spyOn(client, 'isConnected').mockReturnValue(true);
  isGuildMember = jest.spyOn(client, 'isGuildMember').mockResolvedValue(true);
  sendEmbedDM = jest.spyOn(client, 'sendEmbedDM').mockResolvedValue();
});

afterEach(async () => {
  sendEmbedDM.mockRestore();
  isGuildMember.mockRestore();
  isConnected.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('post-event setup DM honours Post-Event Follow-Ups (ROK-2317)', () => {
  it('sends no DM when the account turned Discord off for follow-ups', async () => {
    const userId = await seedAccountPug(false);
    const eventId = await seedEndedEvent();
    const slotId = await seedPugSlot(eventId, { userId });

    await runReminderPass();

    expect(dmRecipients()).toEqual([]);
    // The slot was still handled (deduped), so it is not retried next minute.
    expect(await dedupRows(slotId)).toBe(1);
  });

  it('sends the DM when the switch is explicitly on', async () => {
    const userId = await seedAccountPug(true);
    const eventId = await seedEndedEvent();
    await seedPugSlot(eventId, { userId });

    await runReminderPass();

    expect(dmRecipients()).toEqual([ACCOUNT_DISCORD_ID]);
  });

  it('sends the DM when the account never saved preferences (default on)', async () => {
    const userId = await seedAccountPug('no-row');
    const eventId = await seedEndedEvent();
    await seedPugSlot(eventId, { userId });

    await runReminderPass();

    expect(dmRecipients()).toEqual([ACCOUNT_DISCORD_ID]);
  });

  it('still nudges a Discord id with no Raid Ledger account', async () => {
    const eventId = await seedEndedEvent();
    await seedPugSlot(eventId, { discordId: NO_ACCOUNT_DISCORD_ID });

    await runReminderPass();

    expect(dmRecipients()).toEqual([NO_ACCOUNT_DISCORD_ID]);
  });
});
