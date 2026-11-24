/**
 * ROK-2317 (integration): every event-plan organizer DM (`dmOrganizer`) follows
 * the organizer's Scheduling polls (`scheduling_poll`) Discord switch, and —
 * ruling 5 — cancelling your own plan sends you no "cancelled" DM, while
 * someone else's cancel DMs you through that same switch.
 *
 * Real Postgres; only the bot transport (`sendDirectMessage`, `deleteMessage`)
 * is stubbed. `cancel` fires its DM without awaiting it, so the spec swaps the
 * service's `safeDmOrganizer` for an awaited call to the same `dmOrganizer`.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { resolveChannelPrefs } from '../notifications/notification-mapping.helpers';
import { dmOrganizer } from './event-plans-discord.helpers';
import { EventPlansService } from './event-plans.service';

const ORGANIZER_DISCORD_ID = '231700000000000301';
const HOUR = 3600_000;

let testApp: TestApp;
let adminToken: string;
let client: DiscordBotClientService;
let sendDirectMessage: jest.SpyInstance;
let deleteMessage: jest.SpyInstance;
let organizerDms: Promise<void>[] = [];

/** A Discord-linked organizer; `discord` sets the Scheduling polls switch. */
async function seedOrganizer(discord: boolean | 'no-row') {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: ORGANIZER_DISCORD_ID,
        username: 'organizer_2317',
        role: 'member',
      })
      .returning(),
    'organizer',
  );
  if (discord !== 'no-row') {
    const channelPrefs = resolveChannelPrefs({});
    channelPrefs.scheduling_poll = { ...channelPrefs.scheduling_poll, discord };
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

/** A plan in `polling` created by `creatorId`. */
async function seedPollingPlan(creatorId: number): Promise<string> {
  const option = (h: number) => ({
    date: new Date(Date.now() + h * HOUR).toISOString(),
    label: `Option ${h}`,
  });
  const [plan] = nonEmpty(
    await testApp.db
      .insert(schema.eventPlans)
      .values({
        creatorId,
        title: 'Plan 2317',
        durationMinutes: 120,
        pollOptions: [option(24), option(48)],
        pollDurationHours: 24,
        pollMode: 'standard',
        status: 'polling',
        pollChannelId: 'chan-2317',
        pollMessageId: 'msg-2317',
        pollStartedAt: new Date(),
        pollEndsAt: new Date(Date.now() + 24 * HOUR),
      })
      .returning({ id: schema.eventPlans.id }),
    'plan',
  );
  return plan.id;
}

async function cancelAs(planId: string, token: string) {
  const res = await testApp.request
    .patch(`/event-plans/${planId}/cancel`)
    .set('Authorization', `Bearer ${token}`);
  await Promise.all(organizerDms);
  return res;
}

async function planStatus(planId: string): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ status: schema.eventPlans.status })
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.id, planId)),
    'plan row',
  );
  return row.status;
}

function dmRecipients(): unknown[] {
  return sendDirectMessage.mock.calls.map((call: unknown[]) => call[0]);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  client = testApp.app.get(DiscordBotClientService, { strict: false });
  sendDirectMessage = jest
    .spyOn(client, 'sendDirectMessage')
    .mockResolvedValue(undefined);
  deleteMessage = jest.spyOn(client, 'deleteMessage').mockResolvedValue();
  organizerDms = [];
  const plans = testApp.app.get(EventPlansService, { strict: false });
  plans['safeDmOrganizer'] = (userId: number, msg: string) => {
    organizerDms.push(dmOrganizer(testApp.db, client, userId, msg));
  };
});

afterEach(async () => {
  const plans = testApp.app.get(EventPlansService, { strict: false });
  Reflect.deleteProperty(plans, 'safeDmOrganizer');
  deleteMessage.mockRestore();
  sendDirectMessage.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('dmOrganizer honours Scheduling polls (ROK-2317)', () => {
  it('sends nothing when the organizer turned Discord off for polls', async () => {
    const organizer = await seedOrganizer(false);

    await dmOrganizer(testApp.db, client, organizer.id, 'Your poll closed.');

    expect(dmRecipients()).toEqual([]);
  });

  it('sends the DM when the switch is on', async () => {
    const organizer = await seedOrganizer(true);

    await dmOrganizer(testApp.db, client, organizer.id, 'Your poll closed.');

    expect(dmRecipients()).toEqual([ORGANIZER_DISCORD_ID]);
  });

  it('sends the DM when the organizer never saved preferences', async () => {
    const organizer = await seedOrganizer('no-row');

    await dmOrganizer(testApp.db, client, organizer.id, 'Your poll closed.');

    expect(dmRecipients()).toEqual([ORGANIZER_DISCORD_ID]);
  });
});

describe('plan cancel DM — ruling 5 (ROK-2317)', () => {
  it('sends the creator no DM when they cancel their own plan', async () => {
    const organizer = await seedOrganizer(true);
    const planId = await seedPollingPlan(organizer.id);

    const res = await cancelAs(planId, organizer.token);

    expect(res.status).toBe(200);
    expect(await planStatus(planId)).toBe('cancelled');
    expect(organizerDms).toHaveLength(0);
    expect(dmRecipients()).toEqual([]);
  });

  it('DMs the creator when an admin cancels and polls Discord is on', async () => {
    const organizer = await seedOrganizer(true);
    const planId = await seedPollingPlan(organizer.id);

    const res = await cancelAs(planId, adminToken);

    expect(res.status).toBe(200);
    expect(await planStatus(planId)).toBe('cancelled');
    expect(dmRecipients()).toEqual([ORGANIZER_DISCORD_ID]);
    expect(sendDirectMessage.mock.calls[0]?.[1]).toBe('Your event plan "Plan 2317" has been cancelled.');
  });

  it('sends no DM when an admin cancels but polls Discord is off', async () => {
    const organizer = await seedOrganizer(false);
    const planId = await seedPollingPlan(organizer.id);

    const res = await cancelAs(planId, adminToken);

    expect(res.status).toBe(200);
    expect(await planStatus(planId)).toBe('cancelled');
    expect(organizerDms).toHaveLength(1);
    expect(dmRecipients()).toEqual([]);
  });
});
