/**
 * ROK-2284 lane 2 — the sign-in reminder pass against a real database, with
 * Discord stubbed at the boundary (`getGuild` roster + `sendEmbedDM`):
 * eligibility (account holders, `unlinked:` rows, bots, opt-outs, the 3-day
 * post-launch join wait, cadence, max, switch off) and send outcomes (success
 * stamps, 50007 is recorded and never deactivates or loops, other errors).
 */
import { Collection } from 'discord.js';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { optOutOfSigninReminders } from './signin-reminder.db';
import { SigninReminderService } from './signin-reminder.service';

const T = schema.discordSigninReminders;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY);
interface FakeMember {
  id: string;
  bot?: boolean;
  joinedAt?: Date | null;
}

let testApp: TestApp;
let service: SigninReminderService;
let sendDm: jest.SpyInstance;
let roster: FakeMember[] = [];

function fakeGuild(): unknown {
  const entries = roster.map((m): [string, unknown] => [
    m.id,
    {
      user: { id: m.id, bot: m.bot === true },
      joinedAt: m.joinedAt ?? ago(100),
    },
  ]);
  // REST members.list only: the roster must never use the gateway op-8 fetch.
  return { members: { list: () => Promise.resolve(new Collection(entries)) } };
}

const dmIds = (): string[] =>
  sendDm.mock.calls.map((c: unknown[]) => String(c[0]));
const setting = (
  key: (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS],
  v: string,
) => testApp.app.get(SettingsService).set(key, v);

async function reminderRow(discordId: string) {
  const [row] = await testApp.db
    .select()
    .from(T)
    .where(eq(T.discordId, discordId));
  return row;
}

async function insertUser(discordId: string): Promise<void> {
  await testApp.db
    .insert(schema.users)
    .values({ discordId, username: `rem-${discordId}`, role: 'member' });
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(SigninReminderService);
});

beforeEach(async () => {
  // The switch ships OFF (ruling 2026-11-21); the sending cases turn it on
  // explicitly, the way an admin would. The switch cases override it.
  await setting(SETTING_KEYS.SIGNIN_REMINDER_ENABLED, 'true');
  roster = [];
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuild').mockImplementation(() => fakeGuild() as never);
  sendDm = jest.spyOn(client, 'sendEmbedDM').mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('sign-in reminders — eligibility', () => {
  it('first run: DMs every human member without an account, then sets launched_at once', async () => {
    roster = [
      { id: '7001' },
      { id: '7002' },
      { id: '7003' },
      { id: '7004', bot: true },
      { id: '7005', joinedAt: ago(1) },
    ];
    await insertUser('7002');
    await insertUser('unlinked:7003');
    const outcome = await service.runTick(NOW);
    expect(outcome).toEqual({
      status: 'ran',
      candidates: 2,
      sent: 2,
      failed: 0,
    });
    expect(dmIds().sort()).toEqual(['7001', '7005']);
    const settings = testApp.app.get(SettingsService);
    const launched = await settings.get(
      SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT,
    );
    expect(launched).toBe(NOW.toISOString());
    expect(await reminderRow('7002')).toBeUndefined();
    await service.runTick(new Date(NOW.getTime() + DAY));
    expect(await settings.get(SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT)).toBe(
      launched,
    );
    expect(sendDm).toHaveBeenCalledTimes(2);
  });

  it('paces the first wave at 25 per tick', async () => {
    roster = Array.from({ length: 30 }, (_, i) => ({
      id: `71${String(i).padStart(3, '0')}`,
    }));
    expect(await service.runTick(NOW)).toMatchObject({ sent: 25 });
    expect(await service.runTick(NOW)).toMatchObject({ sent: 5 });
    expect(new Set(dmIds()).size).toBe(30);
  });

  it('after launch, a member who joined 2 days ago waits; 4 days ago is due', async () => {
    await setting(
      SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT,
      ago(30).toISOString(),
    );
    roster = [
      { id: '7201', joinedAt: ago(2) },
      { id: '7202', joinedAt: ago(4) },
      { id: '7203', joinedAt: ago(40) },
    ];
    await service.runTick(NOW);
    expect(dmIds().sort()).toEqual(['7202', '7203']);
  });
});

describe('sign-in reminders — per-person filters', () => {
  it('opted-out members are never DMed', async () => {
    roster = [{ id: '7301' }, { id: '7302' }];
    await optOutOfSigninReminders(testApp.db, '7301');
    await service.runTick(NOW);
    expect(dmIds()).toEqual(['7302']);
  });

  it('honours the weeks cadence and the lifetime max from the settings', async () => {
    roster = [{ id: '7401' }, { id: '7402' }, { id: '7403' }];
    await testApp.db.insert(T).values([
      { discordId: '7401', sentCount: 3, lastSentAt: ago(100) },
      { discordId: '7402', sentCount: 1, lastSentAt: ago(22) },
      { discordId: '7403', sentCount: 1, lastSentAt: ago(10) },
    ]);
    await service.runTick(NOW);
    expect(dmIds()).toEqual(['7402']);
    sendDm.mockClear();
    await setting(SETTING_KEYS.SIGNIN_REMINDER_MAX, '5');
    await setting(SETTING_KEYS.SIGNIN_REMINDER_WEEKS, '1');
    await service.runTick(NOW);
    expect(dmIds().sort()).toEqual(['7401', '7403']);
  });

  it("switch 'false' ⇒ zero sends and no launch time", async () => {
    roster = [{ id: '7501' }];
    await setting(SETTING_KEYS.SIGNIN_REMINDER_ENABLED, 'false');
    expect(await service.runTick(NOW)).toEqual({ status: 'disabled' });
    expect(sendDm).not.toHaveBeenCalled();
    const launched = await testApp.app
      .get(SettingsService)
      .get(SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT);
    expect(launched).toBeNull();
  });

  it('switch unset ⇒ the cron pass sends nothing and stamps no launch time (ships OFF); explicit true ⇒ runs', async () => {
    roster = [{ id: '7551' }];
    const settings = testApp.app.get(SettingsService);
    await settings.delete(SETTING_KEYS.SIGNIN_REMINDER_ENABLED);
    expect(await service.runTick(NOW)).toEqual({ status: 'disabled' });
    expect(sendDm).not.toHaveBeenCalled();
    expect(
      await settings.get(SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT),
    ).toBeNull();
    await setting(SETTING_KEYS.SIGNIN_REMINDER_ENABLED, 'true');
    expect(await service.runTick(NOW)).toMatchObject({
      status: 'ran',
      sent: 1,
    });
    expect(dmIds()).toEqual(['7551']);
    expect(await settings.get(SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT)).toBe(
      NOW.toISOString(),
    );
  });

  it('bot offline ⇒ not-connected, nothing sent', async () => {
    jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'getGuild')
      .mockReturnValue(null);
    expect(await service.runTick(NOW)).toEqual({ status: 'not-connected' });
    expect(sendDm).not.toHaveBeenCalled();
  });
});

describe('sign-in reminders — send outcomes', () => {
  it('success stamps the row and clears the claim', async () => {
    roster = [{ id: '7601' }];
    await service.runTick(NOW);
    expect(await reminderRow('7601')).toMatchObject({
      sentCount: 1,
      claimedAt: null,
      lastFailureCode: null,
    });
    expect((await reminderRow('7601'))?.lastSentAt).not.toBeNull();
  });

  it('50007 is recorded and counted, deactivates nobody and is not retried', async () => {
    roster = [{ id: '7701' }, { id: '7702' }];
    await testApp.db.insert(schema.users).values({
      discordId: '7799',
      username: 'seen',
      role: 'member',
      guildMemberSeenAt: ago(5),
    });
    sendDm.mockImplementation((id: string) =>
      id === '7701'
        ? Promise.reject(
            Object.assign(new Error('Cannot send messages to this user'), {
              code: 50007,
            }),
          )
        : Promise.resolve(),
    );
    expect(await service.runTick(NOW)).toMatchObject({ sent: 1, failed: 1 });
    expect(await reminderRow('7701')).toMatchObject({
      sentCount: 1,
      lastFailureCode: 50007,
      claimedAt: null,
    });
    const deactivated = await testApp.db
      .select()
      .from(schema.users)
      .where(isNotNull(schema.users.deactivatedAt));
    expect(deactivated).toEqual([]);
    sendDm.mockClear();
    await service.runTick(NOW);
    expect(sendDm).not.toHaveBeenCalled();
  });
});

describe('sign-in reminders — other send errors', () => {
  it('a code-less error (bot dropped mid-pass) releases the claim without using up a reminder; the next tick retries', async () => {
    roster = [{ id: '7801' }, { id: '7802' }];
    sendDm.mockImplementation((id: string) =>
      id === '7801'
        ? Promise.reject(new Error('Discord bot is not connected'))
        : Promise.resolve(),
    );
    expect(await service.runTick(NOW)).toMatchObject({ sent: 1, failed: 1 });
    expect(await reminderRow('7801')).toMatchObject({
      sentCount: 0,
      lastSentAt: null,
      lastFailureCode: null,
      claimedAt: null,
    });
    // Stamped for ordering only (retry sorts last); not counted, no cadence.
    expect((await reminderRow('7801'))?.lastFailureAt).not.toBeNull();
    expect(await reminderRow('7802')).toMatchObject({
      sentCount: 1,
      lastFailureAt: null,
    });
    const [pending] = Array.from(
      await testApp.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM discord_signin_reminders WHERE claimed_at IS NOT NULL`,
      ),
    );
    expect(pending?.n).toBe(0);
    sendDm.mockReset().mockResolvedValue(undefined);
    await service.runTick(NOW);
    expect(dmIds()).toEqual(['7801']);
    expect(await reminderRow('7801')).toMatchObject({ sentCount: 1 });
  });

  it('an opt-out pressed after the batch was claimed stops that send and releases the claim', async () => {
    roster = [{ id: '7901' }, { id: '7902' }];
    sendDm.mockImplementation(async (id: string) => {
      // 7902 presses "Don't remind me again" on an older DM mid-pass.
      if (id === '7901') await optOutOfSigninReminders(testApp.db, '7902');
    });
    expect(await service.runTick(NOW)).toMatchObject({ sent: 1, failed: 0 });
    expect(dmIds()).toEqual(['7901']);
    const row = await reminderRow('7902');
    expect(row).toMatchObject({ sentCount: 0, claimedAt: null });
    expect(row?.optedOutAt).not.toBeNull();
  });
});
