/**
 * ROK-2284 — `/admin/test/signin-reminder/*` (integration, real DB): the
 * jwt + admin + DEMO_MODE guard trio, the bot-only targeted tick (it never
 * DMs a human, even one named in the body), reset and state.
 * Discord is stubbed at the boundary (`getGuild` roster + `sendEmbedDM`).
 */
import { Collection } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { SIGNIN_REMINDER_BUTTON_IDS } from '../plugins/core/signin-reminder/signin-reminder.constants';
import { SigninReminderService } from '../plugins/core/signin-reminder/signin-reminder.service';
import type { SigninReminderStateResponse } from './demo-test-signin-reminder.controller';

const BOT = '400000000000000001';
const HUMAN = '400000000000000002';
const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

let testApp: TestApp;
let adminToken: string;
let sendDm: jest.SpyInstance;

function fakeGuild(): unknown {
  const member = (id: string, bot: boolean): [string, unknown] => [
    id,
    { user: { id, bot }, joinedAt: new Date(Date.now() - 100 * 86_400_000) },
  ];
  const entries = [member(BOT, true), member(HUMAN, false)];
  // REST members.list only: the roster must never use the gateway op-8 fetch.
  return { members: { list: () => Promise.resolve(new Collection(entries)) } };
}

function post(path: string, token: string | null, body: object) {
  const req = testApp.request.post(`/admin/test/signin-reminder/${path}`);
  return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
}

beforeAll(async () => {
  testApp = await getTestApp();
  process.env.DEMO_MODE = 'true';
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await testApp.app.get(SettingsService).setDemoMode(true);
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuild').mockImplementation(() => fakeGuild() as never);
  sendDm = jest.spyOn(client, 'sendEmbedDM').mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  process.env.DEMO_MODE = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('ROK-2284 signin-reminder fixture — guards', () => {
  it('refuses no token (401), a non-admin (403) and DEMO_MODE off (403)', async () => {
    const member = await createMemberAndLogin(testApp, 'srm', 'srm@test.local');
    const body = { botDiscordId: BOT };
    expect((await post('tick', null, body)).status).toBe(401);
    expect((await post('tick', member.token, body)).status).toBe(403);
    process.env.DEMO_MODE = 'false';
    for (const path of ['tick', 'reset', 'state']) {
      const res = await post(path, adminToken, { ...body, discordId: BOT });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    expect(sendDm).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a snowflake (400)', async () => {
    expect((await post('tick', adminToken, { botDiscordId: 'x' })).status).toBe(
      400,
    );
  });
});

describe('ROK-2284 signin-reminder fixture — targeted tick', () => {
  it('DMs only the named bot, once; the human in the roster gets nothing', async () => {
    const first = await post('tick', adminToken, { botDiscordId: BOT });
    expect(first.body).toEqual({
      status: 'ran',
      candidates: 1,
      sent: 1,
      failed: 0,
    });
    expect(sendDm.mock.calls.map((c: unknown[]) => c[0])).toEqual([BOT]);
    const second = await post('tick', adminToken, { botDiscordId: BOT });
    expect(second.body).toEqual({
      status: 'ran',
      candidates: 1,
      sent: 0,
      failed: 0,
    });
    expect(sendDm).toHaveBeenCalledTimes(1);
  });

  it('still targets the bot when the smoke has linked it to a demo user', async () => {
    const member = await createMemberAndLogin(testApp, 'srb', 'srb@test.local');
    await testApp.db
      .update(schema.users)
      .set({ discordId: BOT })
      .where(eq(schema.users.id, member.userId));
    const res = await post('tick', adminToken, { botDiscordId: BOT });
    expect(res.body).toEqual({
      status: 'ran',
      candidates: 1,
      sent: 1,
      failed: 0,
    });
    expect(sendDm.mock.calls.map((c: unknown[]) => c[0])).toEqual([BOT]);
  });

  it('records a bot-to-bot refusal (50007) and the next tick sends nothing', async () => {
    sendDm.mockRejectedValueOnce(
      Object.assign(new Error('Cannot send'), { code: 50007 }),
    );
    const first = await post('tick', adminToken, { botDiscordId: BOT });
    expect(first.body).toEqual({
      status: 'ran',
      candidates: 1,
      sent: 0,
      failed: 1,
    });
    const state = (await post('state', adminToken, { discordId: BOT }))
      .body as SigninReminderStateResponse;
    expect(state.row).toMatchObject({ sentCount: 1, lastFailureCode: 50007 });
    const second = await post('tick', adminToken, { botDiscordId: BOT });
    expect(second.body).toEqual({
      status: 'ran',
      candidates: 1,
      sent: 0,
      failed: 0,
    });
    expect(sendDm).toHaveBeenCalledTimes(1);
  });

  it('never DMs a human, even when the body names one', async () => {
    const res = await post('tick', adminToken, { botDiscordId: HUMAN });
    expect(res.body).toEqual({
      status: 'ran',
      candidates: 0,
      sent: 0,
      failed: 0,
    });
    expect(sendDm).not.toHaveBeenCalled();
  });
});

describe('ROK-2284 signin-reminder fixture — state and reset', () => {
  it('state shows the row and the DM; reset makes the bot due again', async () => {
    await post('tick', adminToken, { botDiscordId: BOT });
    const state = (await post('state', adminToken, { discordId: BOT }))
      .body as SigninReminderStateResponse;
    expect(state.row).toMatchObject({ sentCount: 1, optedOutAt: null });
    expect(JSON.stringify(state.dm.components)).toContain(
      SIGNIN_REMINDER_BUTTON_IDS.STOP,
    );
    const reset = await post('reset', adminToken, { discordId: BOT });
    expect(reset.body).toEqual({ deleted: 1 });
    const after = (await post('state', adminToken, { discordId: BOT }))
      .body as SigninReminderStateResponse;
    expect(after.row).toBeNull();
    const again = await post('tick', adminToken, { botDiscordId: BOT });
    expect(again.body).toMatchObject({ status: 'ran', sent: 1 });
  });
});

describe('ROK-2284 signin-reminder fixture — switch ships OFF', () => {
  it('switch unset: the cron pass is disabled and stamps no launch time, but the bot-targeted tick still runs', async () => {
    const settings = testApp.app.get(SettingsService);
    await settings.delete(schema.SETTING_KEYS.SIGNIN_REMINDER_ENABLED);
    const cron = await testApp.app.get(SigninReminderService).runTick();
    expect(cron).toEqual({ status: 'disabled' });
    expect(sendDm).not.toHaveBeenCalled();
    expect(
      await settings.get(schema.SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT),
    ).toBeNull();
    const res = await post('tick', adminToken, { botDiscordId: BOT });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ran', sent: 1 });
    expect(sendDm.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([
      BOT,
    ]);
    expect(
      await settings.get(schema.SETTING_KEYS.SIGNIN_REMINDER_LAUNCHED_AT),
    ).toBeNull();
  });
});
