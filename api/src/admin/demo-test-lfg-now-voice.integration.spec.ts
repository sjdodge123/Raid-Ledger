/**
 * DemoTestLfgNowVoiceController against a real DB and the real Nest wiring.
 *
 * The unit spec mocks `recordLfgNowVoiceJoin` / `recordLfgNowVoiceLeave`, so it
 * cannot see what breaks at module level: the `AdHocParticipantService`
 * singleton `DiscordBotModule` exports for this controller, the
 * `forwardRef(UsersModule)` injection, and the roster row + PARTICIPANT_JOINED
 * a join must actually produce. Before this spec only the Discord smoke
 * (`lfm-playing.test.ts`) covered them, and it runs only on Discord-path PRs.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { AD_HOC_EVENTS } from '../discord-bot/discord-bot.constants';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
/** The LFG-born event's temp channel — a snowflake, as the body schema requires. */
const VOICE_CHANNEL = '1494000000000000001';
/** A channel no open LFG-born event owns. */
const OTHER_CHANNEL = '1494000000000000999';
/** A real-shaped Discord id: `local:` / `unlinked:` users are refused. */
const DISCORD_ID = '1494000000000000777';

let testApp: TestApp;
let adminToken: string;

/** The controller gates on env DEMO_MODE AND the DB flag truncate wipes. */
async function enableDemoMode(): Promise<void> {
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

async function seedLinkedUser(): Promise<number> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ username: 'voicejoiner', discordId: DISCORD_ID, role: 'member' })
    .returning({ id: schema.users.id });
  return user.id;
}

/** An open LFG-born session: ad-hoc, live, unbound, owning `VOICE_CHANNEL`. */
async function seedLfgBornEvent(): Promise<number> {
  const now = Date.now();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'LFG now — voice endpoint fixture',
      creatorId: testApp.seed.adminUser.id,
      duration: [new Date(now - 5 * 60_000), new Date(now + 55 * 60_000)] as [
        Date,
        Date,
      ],
      gameId: testApp.seed.game.id,
      isAdHoc: true,
      adHocStatus: 'live',
      channelBindingId: null,
      ephemeralVoiceChannelId: VOICE_CHANNEL,
    })
    .returning({ id: schema.events.id });
  return event.id;
}

function postVoice(
  action: 'voice-join' | 'voice-leave',
  body: { userId: number; channelId: string },
) {
  return testApp.request
    .post(`/admin/test/lfg-now/${action}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

function rosterRows(eventId: number) {
  return testApp.db
    .select()
    .from(schema.adHocParticipants)
    .where(eq(schema.adHocParticipants.eventId, eventId));
}

describe('POST /admin/test/lfg-now/voice-join|voice-leave', () => {
  it('join writes one roster row and announces it; leave closes that row', async () => {
    const userId = await seedLinkedUser();
    const eventId = await seedLfgBornEvent();
    const emit = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');
    const target = { userId, channelId: VOICE_CHANNEL };

    const joined = await postVoice('voice-join', target);
    expect(joined.status).toBe(200);
    expect(joined.body).toEqual({ recorded: true, eventId });
    const open = await rosterRows(eventId);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      userId,
      discordUserId: DISCORD_ID,
      leftAt: null,
    });
    // The re-render trigger: a fresh roster row announces itself.
    expect(emit).toHaveBeenCalledWith(AD_HOC_EVENTS.PARTICIPANT_JOINED, {
      eventId,
      userId,
      discordUserId: DISCORD_ID,
    });

    const left = await postVoice('voice-leave', target);
    expect(left.status).toBe(200);
    expect(left.body).toEqual({ recorded: true, eventId });
    const closed = await rosterRows(eventId);
    // The SAME row closed — not a second row, not a delete.
    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe(open[0].id);
    expect(closed[0].leftAt).toBeInstanceOf(Date);
  });

  it('records nothing for a channel no open LFG-born event owns', async () => {
    const userId = await seedLinkedUser();
    const eventId = await seedLfgBornEvent();

    const res = await postVoice('voice-join', {
      userId,
      channelId: OTHER_CHANNEL,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: false, eventId: null });
    expect(await rosterRows(eventId)).toHaveLength(0);
  });
});
