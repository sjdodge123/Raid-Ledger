/**
 * ROK-2305 (integration): the member-invite DM honours the invitee's Discord
 * switch for invites (`new_event`). A member who turned Discord OFF used to
 * get the DM anyway — `sendMemberInviteDm` never read the preferences.
 *
 * Driven at the listener (bots cannot click bots): the real
 * `PugInviteListener` → `PugInviteService` → real Postgres preference read,
 * with only the bot transport (`isConnected` / `sendEmbedDM`) stubbed.
 */
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { createFutureEvent } from '../../events/signups.integration.spec-helpers';
import { resolveChannelPrefs } from '../../notifications/notification-mapping.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PugInviteListener } from '../listeners/pug-invite.listener';

const INVITEE_DISCORD_ID = '230500000000000001';
const UNLINKED_DISCORD_ID = '230500000000000002';

let testApp: TestApp;
let adminToken: string;
let sendEmbedDM: jest.SpyInstance;
let isConnected: jest.SpyInstance;

/** A member with `discordId`; `discord` sets the invite type's Discord switch. */
async function seedInvitee(
  discord: boolean | 'no-row',
  inApp = true,
): Promise<void> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: INVITEE_DISCORD_ID,
        username: 'invitee_2305',
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'invitee',
  );
  if (discord === 'no-row') return;
  const channelPrefs = resolveChannelPrefs({});
  channelPrefs.new_event = { ...channelPrefs.new_event, discord, inApp };
  await testApp.db
    .insert(schema.userNotificationPreferences)
    .values({ userId: user.id, channelPrefs });
}

/** Deliver the member-invite event the way the emitter does. */
async function deliverInvite(eventId: number, discordId: string) {
  const listener = testApp.app.get(PugInviteListener, { strict: false });
  await listener.handleMemberInviteCreated({
    eventId,
    targetDiscordId: discordId,
    notificationId: '00000000-0000-4000-8000-000000002305',
    gameId: null,
  });
}

/** Discord ids the invite DM was sent to. */
function dmRecipients(): unknown[] {
  return sendEmbedDM.mock.calls.map((call: unknown[]) => call[0]);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  const client = testApp.app.get(DiscordBotClientService, { strict: false });
  isConnected = jest.spyOn(client, 'isConnected').mockReturnValue(true);
  sendEmbedDM = jest.spyOn(client, 'sendEmbedDM').mockResolvedValue();
});

afterEach(async () => {
  sendEmbedDM.mockRestore();
  isConnected.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('member-invite DM honours the Discord switch (ROK-2305)', () => {
  it('sends no DM when the invitee turned Discord off for invites', async () => {
    await seedInvitee(false);
    const eventId = await createFutureEvent(testApp, adminToken);

    await deliverInvite(eventId, INVITEE_DISCORD_ID);

    expect(dmRecipients()).toEqual([]);
  });

  it('sends exactly one DM when Discord is on, even with the bell off (ROK-2290)', async () => {
    await seedInvitee(true, false);
    const eventId = await createFutureEvent(testApp, adminToken);

    await deliverInvite(eventId, INVITEE_DISCORD_ID);

    expect(dmRecipients()).toEqual([INVITEE_DISCORD_ID]);
  });

  it('sends the DM when the member never saved preferences (default on)', async () => {
    await seedInvitee('no-row');
    const eventId = await createFutureEvent(testApp, adminToken);

    await deliverInvite(eventId, INVITEE_DISCORD_ID);

    expect(dmRecipients()).toEqual([INVITEE_DISCORD_ID]);
  });

  it('still DMs a Discord user with no Raid Ledger account', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);

    await deliverInvite(eventId, UNLINKED_DISCORD_ID);

    expect(dmRecipients()).toEqual([UNLINKED_DISCORD_ID]);
  });
});
