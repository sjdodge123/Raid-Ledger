/**
 * DemoTestQuickPlayVoiceController against a real DB and the real Nest wiring
 * (ROK-1390).
 *
 * The series quick-play smoke drives this seam, and the smoke runs only on
 * Discord-path PRs. This spec pins what it cannot see cheaply: the
 * `AdHocEventService` / `ChannelBindingsService` / `UsersService` injection in
 * `AdminModule`, the event a join really mints, and the refusals the smoke's
 * fixture documents (404 unknown binding, 400 wrong purpose or unlinked user).
 * Discord I/O is stubbed: the LIVE embed post is the smoke's job, not this one.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
/** The bound voice channel — a snowflake, as the body schema requires. */
const VOICE_CHANNEL = '1390000000000000001';
/** A real-shaped Discord id: `local:` / `unlinked:` users are refused. */
const DISCORD_ID = '1390000000000000777';
/** A well-formed binding id no row carries. */
const UNKNOWN_BINDING = '00000000-0000-4000-8000-000000001390';

let testApp: TestApp;
let adminToken: string;

/** The controller gates on env DEMO_MODE AND the DB flag truncate wipes. */
async function enableDemoMode(): Promise<void> {
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
}

/** Stub the Discord calls the spawn's LIVE embed post would make. */
function stubDiscord(): void {
  const client = testApp.app.get(DiscordBotClientService);
  jest
    .spyOn(client, 'sendEmbed')
    .mockResolvedValue({ id: 'msg-1390' } as never);
  jest
    .spyOn(client, 'editEmbed')
    .mockResolvedValue({ id: 'msg-1390' } as never);
  jest.spyOn(client, 'getGuildId').mockReturnValue('guild-1390');
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

beforeEach(() => stubDiscord());

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

async function seedUser(discordId: string | null): Promise<number> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ username: 'quickplayer', discordId, role: 'member' })
    .returning({ id: schema.users.id });
  return user.id;
}

async function seedBinding(purpose: string): Promise<string> {
  const [binding] = await testApp.db
    .insert(schema.channelBindings)
    .values({
      guildId: 'guild-1390',
      channelId: VOICE_CHANNEL,
      channelType: 'voice',
      bindingPurpose: purpose,
      gameId: testApp.seed.game.id,
    })
    .returning({ id: schema.channelBindings.id });
  return binding.id;
}

function postJoin(body: { userId: number; bindingId: string }) {
  return testApp.request
    .post('/admin/test/quick-play/voice-join')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ...body, channelId: VOICE_CHANNEL });
}

function eventsOf(bindingId: string) {
  return testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.channelBindingId, bindingId));
}

describe('POST /admin/test/quick-play/voice-join', () => {
  it('mints a live ad-hoc event on the binding and rosters the user', async () => {
    await testApp.app.get(SettingsService).setAdHocEventsEnabled(true);
    const userId = await seedUser(DISCORD_ID);
    const bindingId = await seedBinding('game-voice-monitor');

    const res = await postJoin({ userId, bindingId });
    expect(res.status).toBe(200);
    const minted = await eventsOf(bindingId);
    expect(minted).toHaveLength(1);
    expect(res.body).toEqual({ spawned: true, eventId: minted[0].id });
    expect(minted[0]).toMatchObject({ isAdHoc: true, adHocStatus: 'live' });
    const roster = await testApp.db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, minted[0].id));
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ userId, discordUserId: DISCORD_ID });
  });

  it('spawns nothing while the ad-hoc gate is off', async () => {
    // Explicit, so a cached ON from the previous case cannot leak in.
    await testApp.app.get(SettingsService).setAdHocEventsEnabled(false);
    const userId = await seedUser(DISCORD_ID);
    const bindingId = await seedBinding('game-voice-monitor');

    const res = await postJoin({ userId, bindingId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ spawned: false, eventId: null });
    expect(await eventsOf(bindingId)).toHaveLength(0);
  });

  it('404s an unknown binding', async () => {
    const userId = await seedUser(DISCORD_ID);
    const res = await postJoin({ userId, bindingId: UNKNOWN_BINDING });
    expect(res.status).toBe(404);
  });

  it('400s a binding that is not a game-voice-monitor', async () => {
    const userId = await seedUser(DISCORD_ID);
    const bindingId = await seedBinding('game-announcements');
    const res = await postJoin({ userId, bindingId });
    expect(res.status).toBe(400);
    expect(await eventsOf(bindingId)).toHaveLength(0);
  });

  it('400s a user who is not Discord-linked', async () => {
    const userId = await seedUser('local:quickplayer');
    const bindingId = await seedBinding('game-voice-monitor');
    const res = await postJoin({ userId, bindingId });
    expect(res.status).toBe(400);
    expect(await eventsOf(bindingId)).toHaveLength(0);
  });
});
