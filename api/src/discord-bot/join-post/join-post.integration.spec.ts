/**
 * ROK-1740 — the pinned "Join Raid Ledger" post, end to end over HTTP.
 *
 * Real Nest app, real DB (app_settings), real guards; only Discord is faked,
 * at `DiscordBotClientService` (connected flag, guild, bot user), with an
 * in-memory text channel whose `fetch(id)` answers a genuine 10008 once a
 * message is gone. What this file proves is the ADMIN contract: the status
 * codes, the bodies and what ends up stored after each outcome.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import { SettingsService } from '../../settings/settings.service';
import {
  clearJoinPost,
  getJoinPost,
} from '../../settings/settings-join-post.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  FAKE_BOT_ID,
  FULL_PERMS,
  discordError,
  fakeGuild,
  fakeTextChannel,
  type FakeTextChannel,
} from './join-post.integration.spec-helpers';
import { PermissionFlagsBits } from 'discord.js';

const ROUTE = '/admin/settings/discord-bot/join-post';
const FIXTURE_ROUTE = '/admin/test/join-post/delete-message';

let testApp: TestApp;
let settings: SettingsService;
let adminToken: string;
let chan: FakeTextChannel;
let noManage: FakeTextChannel;

function stubDiscord(channels: FakeTextChannel[]): void {
  const client = testApp.app.get(DiscordBotClientService, { strict: false });
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuild').mockReturnValue(fakeGuild(channels) as never);
  jest
    .spyOn(client, 'getBotUser')
    .mockReturnValue({ id: FAKE_BOT_ID, username: 'rl-bot' });
}

function post(channelId: string, token = adminToken) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send({ channelId });
}

function remove(token = adminToken) {
  return testApp.request.delete(ROUTE).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService, { strict: false });
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(async () => {
  chan = fakeTextChannel('c-main');
  noManage = fakeTextChannel(
    'c-nomanage',
    FULL_PERMS.filter((p) => p !== PermissionFlagsBits.PinMessages),
  );
  stubDiscord([chan, noManage]);
  await clearJoinPost(settings);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await clearJoinPost(settings);
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('POST join-post (publish)', () => {
  it('creates, pins and stores the ids', async () => {
    const res = await post(chan.id).expect(200);
    expect(res.body).toMatchObject({
      outcome: 'created',
      channelId: chan.id,
      messageId: `${chan.id}-msg-1`,
      pinned: true,
      warning: null,
    });
    expect(chan.send).toHaveBeenCalledTimes(1);
    expect(chan.store.get(`${chan.id}-msg-1`)?.pinned).toBe(true);
    expect(await getJoinPost(settings)).toEqual({
      channelId: chan.id,
      messageId: `${chan.id}-msg-1`,
    });
  });

  it('re-post edits the stored message — one send in total', async () => {
    await post(chan.id).expect(200);
    const res = await post(chan.id).expect(200);
    expect(res.body).toMatchObject({
      outcome: 'edited',
      messageId: `${chan.id}-msg-1`,
    });
    expect(chan.send).toHaveBeenCalledTimes(1);
    expect(chan.store.get(`${chan.id}-msg-1`)?.edit).toHaveBeenCalledTimes(1);
    expect(chan.store.size).toBe(1);
  });

  it('re-creates when Discord answers 10008 for the stored message', async () => {
    await post(chan.id).expect(200);
    chan.store.clear(); // a moderator deleted it
    const res = await post(chan.id).expect(200);
    expect(res.body).toMatchObject({
      outcome: 'recreated',
      messageId: `${chan.id}-msg-2`,
      pinned: true,
    });
    expect((await getJoinPost(settings)).messageId).toBe(`${chan.id}-msg-2`);
  });
});

describe('POST join-post (failures)', () => {
  it('any other Discord error is a 503 that sends and stores nothing', async () => {
    await post(chan.id).expect(200);
    chan.messages.fetch.mockRejectedValueOnce(discordError(130000));
    const res = await post(chan.id);
    expect(res.status).toBe(503);
    expect(chan.send).toHaveBeenCalledTimes(1);
    expect(await getJoinPost(settings)).toEqual({
      channelId: chan.id,
      messageId: `${chan.id}-msg-1`,
    });
  });

  it('missing Pin Messages → 422 naming it, nothing sent', async () => {
    const res = await post(noManage.id);
    expect(res.status).toBe(422);
    expect(res.body.missing).toEqual(['Pin Messages']);
    expect(noManage.send).not.toHaveBeenCalled();
    expect(await getJoinPost(settings)).toEqual({
      channelId: null,
      messageId: null,
    });
  });

  it('a pin refusal (30003) still posts: 200, pinned:false + warning', async () => {
    chan.send.mockImplementationOnce(async (payload: unknown) => {
      const msg = await fakeTextChannel('x').send(payload);
      msg.pin.mockRejectedValue(discordError(30003));
      chan.store.set(msg.id, msg);
      return msg;
    });
    const res = await post(chan.id).expect(200);
    expect(res.body.pinned).toBe(false);
    expect(res.body.warning).toContain('maximum of 50 pinned messages');
    expect((await getJoinPost(settings)).messageId).toBe(res.body.messageId);
  });

  it('a non-admin is refused with 403', async () => {
    const member = await createMemberAndLogin(
      testApp,
      'joinpost-member',
      'joinpost-member@test.local',
    );
    await post(chan.id, member.token).expect(403);
    await remove(member.token).expect(403);
    expect(chan.send).not.toHaveBeenCalled();
  });
});

describe('DELETE join-post (remove)', () => {
  it('deletes the message and clears the stored ids', async () => {
    await post(chan.id).expect(200);
    const res = await remove().expect(200);
    expect(res.body).toEqual({ removed: true });
    expect(chan.store.size).toBe(0);
    expect(await getJoinPost(settings)).toEqual({
      channelId: null,
      messageId: null,
    });
  });

  it('answers removed:false when nothing is stored', async () => {
    const res = await remove().expect(200);
    expect(res.body).toEqual({ removed: false });
    expect(chan.messages.delete).not.toHaveBeenCalled();
  });
});

describe('DEMO fixture: delete-message', () => {
  const originalDemo = process.env.DEMO_MODE;
  afterEach(async () => {
    process.env.DEMO_MODE = originalDemo;
    await settings.setDemoMode(false);
  });

  it('deletes the stored message but keeps the settings', async () => {
    process.env.DEMO_MODE = 'true';
    await settings.setDemoMode(true);
    await post(chan.id).expect(200);
    const res = await testApp.request
      .post(FIXTURE_ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({ deleted: true, messageId: `${chan.id}-msg-1` });
    expect(chan.store.size).toBe(0);
    expect((await getJoinPost(settings)).messageId).toBe(`${chan.id}-msg-1`);
    const again = await post(chan.id).expect(200);
    expect(again.body.outcome).toBe('recreated');
  });
});
