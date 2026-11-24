/**
 * ROK-2317 (integration): the post-claim "You have joined X" DM follows the
 * claimer's Event invites (`new_event`) Discord switch (ruling Q2). The claim
 * itself — signup written, response shape — is unchanged either way.
 *
 * Driven over HTTP (`POST /invite/:code/claim` on a share link) against
 * Postgres; only the bot transport is stubbed. The DM is fire-and-forget, so
 * the spec awaits the in-flight `sendPostClaimDM` promise rather than polling.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { PugInviteService } from '../discord-bot/services/pug-invite.service';
import { resolveChannelPrefs } from '../notifications/notification-mapping.helpers';
import { InviteService } from './invite.service';

const MEMBER_DISCORD_ID = '231700000000000201';
const SHARE_CODE = 'rok2317a';
const HOUR = 3600_000;

let testApp: TestApp;
let sendDirectMessage: jest.SpyInstance;
let isConnected: jest.SpyInstance;
let serverInviteFor: jest.SpyInstance;
let pendingDms: Promise<void>[] = [];

/** A Discord-linked member; `discord` sets the Event invites switch. */
async function seedMember(discord: boolean | 'no-row') {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: MEMBER_DISCORD_ID,
        username: 'claimer_2317',
        role: 'member',
      })
      .returning(),
    'member',
  );
  if (discord !== 'no-row') {
    const channelPrefs = resolveChannelPrefs({});
    channelPrefs.new_event = { ...channelPrefs.new_event, discord };
    await testApp.db
      .insert(schema.userNotificationPreferences)
      .values({ userId: user.id, channelPrefs });
  }
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
  });
  return { id: user.id, token };
}

/** An upcoming event carrying a share-link invite code. */
async function seedShareEvent(): Promise<number> {
  const start = Date.now() + HOUR;
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Claim Raid 2317',
        creatorId: testApp.seed.adminUser.id,
        duration: [new Date(start), new Date(start + HOUR)] as [Date, Date],
        inviteCode: SHARE_CODE,
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return event.id;
}

/** Claim the share link, then wait for the fire-and-forget DM to settle. */
async function claimAndSettle(token: string) {
  const res = await testApp.request
    .post(`/invite/${SHARE_CODE}/claim`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  await Promise.all(pendingDms);
  return res;
}

async function signupCount(eventId: number, userId: number): Promise<number> {
  const s = schema.eventSignups;
  const rows = await testApp.db
    .select({ id: s.id })
    .from(s)
    .where(and(eq(s.eventId, eventId), eq(s.userId, userId)));
  return rows.length;
}

function dmRecipients(): unknown[] {
  return sendDirectMessage.mock.calls.map((call: unknown[]) => call[0]);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  const client = testApp.app.get(DiscordBotClientService, { strict: false });
  isConnected = jest.spyOn(client, 'isConnected').mockReturnValue(true);
  sendDirectMessage = jest
    .spyOn(client, 'sendDirectMessage')
    .mockResolvedValue(undefined);
  serverInviteFor = jest
    .spyOn(testApp.app.get(PugInviteService, { strict: false }), 'serverInviteFor')
    .mockResolvedValue(null);
  // Record each post-claim DM promise so the spec can await it.
  const invite = testApp.app.get(InviteService, { strict: false });
  const original = invite['sendPostClaimDM'].bind(invite);
  pendingDms = [];
  invite['sendPostClaimDM'] = (...args: Parameters<typeof original>) => {
    const p = original(...args);
    pendingDms.push(p.catch(() => undefined));
    return p;
  };
});

afterEach(async () => {
  const invite = testApp.app.get(InviteService, { strict: false });
  Reflect.deleteProperty(invite, 'sendPostClaimDM');
  serverInviteFor.mockRestore();
  sendDirectMessage.mockRestore();
  isConnected.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('post-claim DM honours Event invites (ROK-2317)', () => {
  it('signs the member up but sends no DM when Discord is off for invites', async () => {
    const member = await seedMember(false);
    const eventId = await seedShareEvent();

    const res = await claimAndSettle(member.token);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'signup', eventId });
    expect(await signupCount(eventId, member.id)).toBe(1);
    expect(pendingDms).toHaveLength(1);
    expect(dmRecipients()).toEqual([]);
  });

  it('signs the member up and DMs them when the switch is on', async () => {
    const member = await seedMember(true);
    const eventId = await seedShareEvent();

    const res = await claimAndSettle(member.token);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'signup', eventId });
    expect(await signupCount(eventId, member.id)).toBe(1);
    expect(dmRecipients()).toEqual([MEMBER_DISCORD_ID]);
  });

  it('DMs a member who never saved preferences (default on)', async () => {
    const member = await seedMember('no-row');
    const eventId = await seedShareEvent();

    const res = await claimAndSettle(member.token);

    expect(res.status).toBe(201);
    expect(await signupCount(eventId, member.id)).toBe(1);
    expect(dmRecipients()).toEqual([MEMBER_DISCORD_ID]);
  });
});
