/**
 * ROK-1933 Part 4 — the hub welcome embed against a real DB (guild_profiles
 * ids) with Discord faked at `DiscordBotClientService` by the ROK-1740
 * in-memory channel (a deleted message answers a genuine 10008). The event
 * cases go through the real `@OnEvent` listener via `emitAsync`.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { HubWelcomeResultSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { HUB_CHANNEL_EVENTS } from '../../guilds/hub-channel.events';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import {
  VALHEIM_GAME_SLUG,
  VALHEIM_PLUGIN_ID,
} from '../../plugins/valheim/valheim.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  FAKE_BOT_ID,
  discordError,
  fakeGuild,
  fakeTextChannel,
  type FakeTextChannel,
} from '../join-post/join-post.integration.spec-helpers';
import { HubWelcomeService } from './hub-welcome.service';

let testApp: TestApp;
let welcome: HubWelcomeService;
let events: EventEmitter2;
let adminToken: string;
let chanA: FakeTextChannel;
let chanB: FakeTextChannel;
let hubId: number;

async function valheimGameId(): Promise<number> {
  await testApp.db
    .insert(schema.games)
    .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
    .onConflictDoNothing();
  const [g] = nonEmpty(
    await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.slug, VALHEIM_GAME_SLUG)),
    'valheim game',
  );
  return g.id;
}

async function insertServerHub(gameId: number): Promise<number> {
  const [server] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: 'uuid-1933',
        identifier: 'id1933',
        name: 'Vale',
        gameId,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_server',
        name: 'Ashlands',
        nameKey: 'ashlands',
        region: 'server',
        source: 'pelican',
        pelicanServerId: server.id,
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return hub.id;
}

async function bind(guildId: number, channelId: string): Promise<void> {
  await testApp.db
    .insert(schema.guildProfiles)
    .values({ guildId, discordChannelId: channelId })
    .onConflictDoUpdate({
      target: schema.guildProfiles.guildId,
      set: { discordChannelId: channelId },
    });
}

async function stored(): Promise<{
  channel: string | null;
  message: string | null;
}> {
  const [row] = await testApp.db
    .select({
      channel: schema.guildProfiles.welcomeChannelId,
      message: schema.guildProfiles.welcomeMessageId,
    })
    .from(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, hubId));
  return { channel: row?.channel ?? null, message: row?.message ?? null };
}

function link(channelId: string, previousChannelId: string | null = null) {
  return events.emitAsync(HUB_CHANNEL_EVENTS.LINKED, {
    guildId: hubId,
    channelId,
    previousChannelId,
  });
}

/**
 * Install + activate the plugins the HTTP route needs. `HubKindActiveGuard`
 * resolves the `game_server` kind through the pelican adapter, so pelican
 * must be active; valheim owns the welcome. `truncateAllTables` may wipe
 * `plugins`, so install first (as forever-config.integration.spec does).
 */
async function activateHubPlugins(): Promise<void> {
  const registry = testApp.app.get(PluginRegistryService);
  for (const slug of [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID]) {
    await registry.ensureInstalled(slug);
    await registry.activate(slug);
  }
}

beforeAll(async () => {
  testApp = await getTestApp();
  welcome = testApp.app.get(HubWelcomeService, { strict: false });
  events = testApp.app.get(EventEmitter2);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(async () => {
  chanA = fakeTextChannel('c-a');
  chanB = fakeTextChannel('c-b');
  const client = testApp.app.get(DiscordBotClientService, { strict: false });
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest
    .spyOn(client, 'getGuild')
    .mockReturnValue(fakeGuild([chanA, chanB]) as never);
  jest
    .spyOn(client, 'getBotUser')
    .mockReturnValue({ id: FAKE_BOT_ID, username: 'rl-bot' });
  hubId = await insertServerHub(await valheimGameId());
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('hub welcome — linked event', () => {
  it('posts + pins, then edits the same message on a re-link', async () => {
    await link('c-a');
    const first = await stored();
    expect(first.channel).toBe('c-a');
    expect(chanA.store.get(first.message ?? '')?.pinned).toBe(true);
    await link('c-a', 'c-a');
    expect(await stored()).toEqual(first);
    expect(chanA.send).toHaveBeenCalledTimes(1);
    expect(chanA.store.get(first.message ?? '')?.edit).toHaveBeenCalledTimes(1);
  });

  it('two concurrent link events for one hub post once', async () => {
    await Promise.all([link('c-a'), link('c-a')]);
    expect(chanA.send).toHaveBeenCalledTimes(1);
    expect((await stored()).channel).toBe('c-a');
  });

  it('a channel change posts in the new channel and deletes the old', async () => {
    await link('c-a');
    const old = await stored();
    await link('c-b', 'c-a');
    const now = await stored();
    expect(now.channel).toBe('c-b');
    expect(chanB.store.has(now.message ?? '')).toBe(true);
    expect(chanA.store.has(old.message ?? '')).toBe(false);
  });

  it('skips a hub that is not a Valheim server hub', async () => {
    await testApp.db
      .update(schema.guilds)
      .set({ gameId: testApp.seed.game.id })
      .where(eq(schema.guilds.id, hubId));
    expect(await welcome.welcomeLinked(hubId, 'c-a')).toBeNull();
    expect(chanA.send).not.toHaveBeenCalled();
  });
});

describe('hub welcome — re-post', () => {
  it('re-posts when the stored message is gone (10008)', async () => {
    await bind(hubId, 'c-a');
    await link('c-a');
    const old = await stored();
    chanA.store.delete(old.message ?? '');
    const out = await welcome.repost(hubId);
    expect(out).toEqual({ result: 'posted', pinned: true, warning: null });
    const now = await stored();
    expect(now.message).not.toBe(old.message);
    expect(chanA.store.has(now.message ?? '')).toBe(true);
  });

  it('a transient read failure is a 503 and never a duplicate', async () => {
    await bind(hubId, 'c-a');
    await link('c-a');
    const before = await stored();
    chanA.messages.fetch.mockRejectedValueOnce(discordError(500));
    await expect(welcome.repost(hubId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(chanA.send).toHaveBeenCalledTimes(1);
    expect(await stored()).toEqual(before);
  });

  it('POST guilds/:id/discord/welcome edits and returns the contract shape', async () => {
    await activateHubPlugins();
    await bind(hubId, 'c-a');
    await link('c-a');
    const res = await testApp.request
      .post(`/guilds/${hubId}/discord/welcome`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(HubWelcomeResultSchema.parse(res.body)).toEqual({
      result: 'edited',
      pinned: true,
      warning: null,
    });
  });
});

describe('hub welcome — cleared event', () => {
  it('deletes the stored message and clears the ids', async () => {
    await link('c-a');
    const old = await stored();
    await events.emitAsync(HUB_CHANNEL_EVENTS.CLEARED, {
      guildId: hubId,
      previousChannelId: 'c-a',
    });
    expect(chanA.store.has(old.message ?? '')).toBe(false);
    expect(await stored()).toEqual({ channel: null, message: null });
  });
});
