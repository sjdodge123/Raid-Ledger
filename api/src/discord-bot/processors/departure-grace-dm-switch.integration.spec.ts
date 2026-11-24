/**
 * ROK-2317 (integration): the creator's "promote from bench?" DM follows the
 * creator's Slot Vacated (`slot_vacated`) Discord switch. The Slot Vacated
 * bell row is written regardless — the switch only gates the DM.
 *
 * Driven through the real `DepartureGraceProcessor.process` against Postgres
 * (event in progress, full at capacity 1, one rostered player departing, one
 * bench player waiting); only the bot transport is stubbed.
 */
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { resolveChannelPrefs } from '../../notifications/notification-mapping.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import type { DepartureGraceJobData } from '../queues/departure-grace.queue';
import { DepartureGraceProcessor } from './departure-grace.processor';

const CREATOR_DISCORD_ID = '231700000000000401';
const MINUTE = 60_000;
let seq = 0;

let testApp: TestApp;
let sendEmbedDM: jest.SpyInstance;
let isConnected: jest.SpyInstance;

/** The event creator; `discord` sets the Slot Vacated Discord switch. */
async function seedCreator(discord: boolean | 'no-row'): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: CREATOR_DISCORD_ID,
        username: 'creator_2317',
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'creator',
  );
  if (discord !== 'no-row') {
    const channelPrefs = resolveChannelPrefs({});
    channelPrefs.slot_vacated = { ...channelPrefs.slot_vacated, discord };
    await testApp.db
      .insert(schema.userNotificationPreferences)
      .values({ userId: user.id, channelPrefs });
  }
  return user.id;
}

/** A member signed up on `eventId` and placed in `role`. */
async function seedSignup(
  eventId: number,
  role: 'player' | 'bench',
): Promise<number> {
  seq += 1;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `23170000000000${String(500 + seq).padStart(4, '0')}`,
        username: `attendee_2317_${seq}`,
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'attendee',
  );
  const [signup] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId, userId: user.id, status: 'signed_up' })
      .returning({ id: schema.eventSignups.id }),
    'signup',
  );
  await testApp.db
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId: signup.id, role, position: 1 });
  return signup.id;
}

/** In-progress event at capacity 1: one rostered player plus a bench player. */
async function seedFullLiveEvent(creatorId: number) {
  const now = Date.now();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Live Raid 2317',
        creatorId,
        maxAttendees: 1,
        duration: [
          new Date(now - 30 * MINUTE),
          new Date(now + 120 * MINUTE),
        ] as [Date, Date],
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  const playerSignupId = await seedSignup(event.id, 'player');
  await seedSignup(event.id, 'bench');
  return { eventId: event.id, playerSignupId };
}

async function runDeparture(eventId: number, signupId: number): Promise<void> {
  const job = {
    data: { eventId, discordUserId: 'gone-2317', signupId },
  } as Job<DepartureGraceJobData>;
  await testApp.app.get(DepartureGraceProcessor).process(job);
}

async function slotVacatedRows(userId: number): Promise<number> {
  const n = schema.notifications;
  const rows = await testApp.db
    .select({ id: n.id })
    .from(n)
    .where(and(eq(n.userId, userId), eq(n.type, 'slot_vacated')));
  return rows.length;
}

function dmRecipients(): unknown[] {
  return sendEmbedDM.mock.calls.map((call: unknown[]) => call[0]);
}

beforeAll(async () => {
  testApp = await getTestApp();
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
});

describe('promote-from-bench DM honours Slot Vacated (ROK-2317)', () => {
  it('sends no promote DM when Discord is off, but still writes the bell row', async () => {
    const creatorId = await seedCreator(false);
    const { eventId, playerSignupId } = await seedFullLiveEvent(creatorId);

    await runDeparture(eventId, playerSignupId);

    expect(dmRecipients()).not.toContain(CREATOR_DISCORD_ID);
    expect(await slotVacatedRows(creatorId)).toBe(1);
  });

  it('sends the promote DM when the switch is on', async () => {
    const creatorId = await seedCreator(true);
    const { eventId, playerSignupId } = await seedFullLiveEvent(creatorId);

    await runDeparture(eventId, playerSignupId);

    expect(dmRecipients()).toContain(CREATOR_DISCORD_ID);
    expect(await slotVacatedRows(creatorId)).toBe(1);
  });

  it('sends the promote DM when the creator never saved preferences', async () => {
    const creatorId = await seedCreator('no-row');
    const { eventId, playerSignupId } = await seedFullLiveEvent(creatorId);

    await runDeparture(eventId, playerSignupId);

    expect(dmRecipients()).toContain(CREATOR_DISCORD_ID);
  });
});
