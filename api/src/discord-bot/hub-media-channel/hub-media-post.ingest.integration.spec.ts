/**
 * ROK-1941 L2 — a bound media channel's posts into the hub gallery against a
 * real database, the downloader stubbed with a `solidPng`: a death post links
 * (or infers) a death on its first picture (D6), screenshot / unclassified
 * kinds, the D4 author rule (webhook in, own bot out), D11 edit + delete, an
 * unbound channel, and the Leader-only `guilds/:id/media-channel` routes.
 */
import { asc, eq } from 'drizzle-orm';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../guilds/hub-hidden.helpers';
import {
  HUB_MEDIA_DOWNLOADER,
  type HubMediaDownloader,
} from '../../hub-media/hub-media-download';
import type { HubMediaHubRef } from '../../hub-media/hub-media-classifier.registry';
import { solidPng } from '../../hub-media/hub-media.testing';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import { fakeServer } from '../../plugins/pelican/testing/pelican-fixtures';
import { ValheimDeathsRepository } from '../../plugins/valheim/armory/valheim-deaths.repository';
import { ensureFixtureHubId } from '../../plugins/valheim/armory/valheim-armory-map-hub.helpers';
import {
  VALHEIM_GAME_SLUG,
  VALHEIM_PLUGIN_ID,
} from '../../plugins/valheim/valheim.constants';
import { ChannelMirrorService } from '../channel-mirror/channel-mirror.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { HubMediaChannelListener } from './hub-media-channel.listener';
import { HubMediaChannelResolver } from './hub-media-channel.queries';
import { HubMediaPostIngest } from './hub-media-post.ingest';
import { toPostLike, type GatewayPost } from './hub-media-post.mapper';

const T = new Date('2026-10-20T12:00:00.000Z');
const DISCORD_GUILD_ID = '500000000000000001';
const OWN_BOT_ID = '600000000000000001';
const WEBHOOK_ID = '600000000000000002';
const DEATH_TEXT = 'Bjorn met their demise! Final moments captured…';

let testApp: TestApp;
let serverId: number;
let hubId: number;
let channelId: string;
let download: jest.SpyInstance;
let seq = 0;

const snowflake = () => {
  seq += 1;
  return `70000000000${String(seq).padStart(7, '0')}`;
};
const at = (offsetSec: number) => new Date(T.getTime() + offsetSec * 1000);
const listener = () => testApp.app.get(HubMediaChannelListener);
const ingest = () => testApp.app.get(HubMediaPostIngest);
const resolver = () => testApp.app.get(HubMediaChannelResolver);

interface PostOpts {
  id?: string;
  content?: string;
  files?: string[];
  authorId?: string;
  channel?: string;
}

/** A gateway message as the listener reads it — plain data, no `Message`. */
function gatewayPost(o: PostOpts = {}): GatewayPost {
  const id = o.id ?? snowflake();
  const channel = o.channel ?? channelId;
  const files = o.files ?? ['Bjorn_2026-10-20_12-00-00.png'];
  const attachments = files.map((name, i) => ({
    id: `${id}${i}`,
    url: `https://cdn.discordapp.com/attachments/${channel}/${id}/${name}`,
    contentType: 'image/png',
    name,
  }));
  return {
    id,
    channelId: channel,
    guildId: DISCORD_GUILD_ID,
    createdAt: T,
    content: o.content ?? DEATH_TEXT,
    author: { id: o.authorId ?? WEBHOOK_ID },
    attachments: { values: () => attachments },
    embeds: [],
  };
}

const mediaRows = () =>
  testApp.db
    .select()
    .from(schema.hubMedia)
    .where(eq(schema.hubMedia.guildId, hubId))
    .orderBy(asc(schema.hubMedia.id));
const deathRows = () =>
  testApp.db
    .select()
    .from(schema.valheimPlayerDeaths)
    .where(eq(schema.valheimPlayerDeaths.pelicanServerId, serverId))
    .orderBy(asc(schema.valheimPlayerDeaths.id));

const logDeath = (offsetSec: number, name = 'Bjorn') =>
  new ValheimDeathsRepository(testApp.db).recordLogDeath(serverId, {
    characterName: name,
    steamId: null,
    loggedAt: at(offsetSec).toISOString().slice(0, 19),
    occurredAt: at(offsetSec),
  });

/** Bind like the PUT route does, then drop the resolver's cached answer. */
async function bind(channel: string): Promise<void> {
  const set = { mediaChannelId: channel, mediaChannelSetAt: new Date() };
  await testApp.db
    .insert(schema.guildProfiles)
    .values({ guildId: hubId, ...set })
    .onConflictDoUpdate({ target: schema.guildProfiles.guildId, set });
  resolver().invalidate(channel);
}

async function hubRef(): Promise<HubMediaHubRef> {
  const hub = await resolver().resolve(channelId);
  if (!hub) throw new Error(`channel ${channelId} resolved to no hub`);
  return hub;
}

async function seedValheimHub(): Promise<void> {
  const registry = testApp.app.get(PluginRegistryService);
  for (const slug of [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID]) {
    await registry.ensureInstalled(slug);
    await registry.activate(slug);
  }
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(1941);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: g.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  serverId = row.id;
  hubId = await ensureFixtureHubId(testApp.db, serverId, g.id);
}

beforeAll(async () => {
  process.env.HUB_MEDIA_DIR = await mkdtemp(join(tmpdir(), 'hub-media-1941-'));
  testApp = await getTestApp();
});

afterAll(() => {
  delete process.env.HUB_MEDIA_DIR;
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await seedValheimHub();
  channelId = snowflake();
  await bind(channelId);
  const png = await solidPng(64, 48, 7);
  const downloader = testApp.app.get<HubMediaDownloader>(HUB_MEDIA_DOWNLOADER);
  download = jest.spyOn(downloader, 'download').mockResolvedValue(png);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('death posts (D6 + the L1 link)', () => {
  it('links the first picture to the console death in the window', async () => {
    await logDeath(-30);
    await listener().onCreate(gatewayPost({ files: ['a.png', 'b.png'] }));
    const media = await mediaRows();
    const first = nonEmpty(media, 'media')[0];
    expect(media.map((m) => [m.kind, m.authorName])).toEqual([
      ['death', 'Bjorn'],
      ['death', 'Bjorn'],
    ]);
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['log', first.id],
    ]);
  });

  it('infers one discord death when no console death is in the window', async () => {
    await listener().onCreate(gatewayPost());
    const [m] = nonEmpty(await mediaRows(), 'media');
    expect(
      (await deathRows()).map((d) => [d.source, d.characterName, d.hubMediaId]),
    ).toEqual([['discord', 'Bjorn', m.id]]);
  });

  it('a re-delivered post stores nothing new and counts the death once', async () => {
    const post = gatewayPost();
    await listener().onCreate(post);
    const summary = await ingest().ingestPost(toPostLike(post), await hubRef());
    expect(summary).toMatchObject({ images: 1, stored: 0, duplicates: 1 });
    expect(await mediaRows()).toHaveLength(1);
    expect(await deathRows()).toHaveLength(1);
  });
});

describe('post kinds', () => {
  it('a screenshot post is `screenshot` and never touches deaths', async () => {
    await logDeath(-10, 'Astrid');
    await listener().onCreate(
      gatewayPost({ content: 'Astrid captured this screenshot!' }),
    );
    const media = await mediaRows();
    expect(media.map((m) => [m.kind, m.authorName])).toEqual([
      ['screenshot', 'Astrid'],
    ]);
    expect((await deathRows()).map((d) => d.hubMediaId)).toEqual([null]);
  });

  it('an unrecognised post is a plain `image` with no author', async () => {
    const summary = await ingest().ingestPost(
      toPostLike(gatewayPost({ content: 'look at this sunset' })),
      await hubRef(),
    );
    expect(summary).toMatchObject({ stored: 1, unclassified: true });
    const media = await mediaRows();
    expect(media.map((m) => [m.kind, m.authorName])).toEqual([['image', null]]);
    expect(await deathRows()).toEqual([]);
  });
});

describe('authors (D4)', () => {
  it('ingests a webhook/bot author and skips only the app’s own posts', async () => {
    const fake = { user: { id: OWN_BOT_ID } };
    jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'getClient')
      .mockReturnValue(fake as never);
    const webhook = gatewayPost({ authorId: WEBHOOK_ID });
    await listener().onCreate(webhook);
    await listener().onCreate(gatewayPost({ authorId: OWN_BOT_ID }));
    const media = await mediaRows();
    expect(media.map((m) => m.discordMessageId)).toEqual([webhook.id]);
    expect(download).toHaveBeenCalledTimes(1);
  });
});

describe('edits and deletes (D11)', () => {
  it('an edit that adds a picture stores it with the stored kind', async () => {
    const id = snowflake();
    await listener().onCreate(gatewayPost({ id, files: ['a.png'] }));
    const edited = gatewayPost({
      id,
      files: ['a.png', 'b.png'],
      content: 'edited: no longer the mod wording',
    });
    await ingest().onEdit(toPostLike(edited), await hubRef());
    const media = await mediaRows();
    expect(media.map((m) => [m.kind, m.removedAt])).toEqual([
      ['death', null],
      ['death', null],
    ]);
    expect(await deathRows()).toHaveLength(1);
  });

  it('an edit that drops a picture tombstones only that one', async () => {
    const id = snowflake();
    await listener().onCreate(gatewayPost({ id, files: ['a.png', 'b.png'] }));
    const edited = gatewayPost({ id, files: ['a.png'] });
    await ingest().onEdit(toPostLike(edited), await hubRef());
    const media = await mediaRows();
    expect(media.map((m) => m.removedAt === null)).toEqual([true, false]);
  });

  it('a delete tombstones the post and removes its inferred discord death', async () => {
    const post = gatewayPost();
    await listener().onCreate(post);
    expect((await deathRows()).map((d) => d.source)).toEqual(['discord']);
    await ingest().onDelete(post.id, await hubRef());
    expect((await mediaRows()).map((m) => m.removedAt === null)).toEqual([
      false,
    ]);
    expect(await deathRows()).toEqual([]);
  });

  it('a delete keeps a console death and releases its link to the tombstone', async () => {
    await logDeath(-30);
    const post = gatewayPost();
    await listener().onCreate(post);
    const [m] = nonEmpty(await mediaRows(), 'media');
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['log', m.id],
    ]);
    await ingest().onDelete(post.id, await hubRef());
    expect((await mediaRows()).map((r) => r.removedAt === null)).toEqual([
      false,
    ]);
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['log', null],
    ]);
  });
});

describe('removed pictures never carry a death (D11)', () => {
  it('an edit that drops the linked first picture moves its inferred death to the new first picture', async () => {
    const post = gatewayPost({ files: ['a.png', 'b.png'] });
    await listener().onCreate(post);
    const [first] = nonEmpty(await mediaRows(), 'media');
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['discord', first.id],
    ]);
    const rest = [...post.attachments.values()].slice(1);
    const edited = { ...post, attachments: { values: () => rest } };
    await ingest().onEdit(toPostLike(edited), await hubRef());
    const after = await mediaRows();
    expect(after.map((m) => m.removedAt === null)).toEqual([false, true]);
    const [, second] = after;
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['discord', second?.id],
    ]);
  });
});

describe('the first picture re-links; a tombstone links nothing (D11 + D6)', () => {
  it('an edit that drops the first picture of a console death re-links it, never infers a second', async () => {
    await logDeath(-30);
    const post = gatewayPost({ files: ['a.png', 'b.png'] });
    await listener().onCreate(post);
    const [first] = nonEmpty(await mediaRows(), 'media');
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['log', first.id],
    ]);
    const rest = [...post.attachments.values()].slice(1);
    const edited = { ...post, attachments: { values: () => rest } };
    await ingest().onEdit(toPostLike(edited), await hubRef());
    const [, second] = await mediaRows();
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['log', second?.id],
    ]);
  });

  // The first picture is the lowest id, not whatever row the heap returns
  // first: touching row `a` moves its tuple behind `b`, which an unordered
  // read then hands back first (and the edit skipped the re-link).
  it('an edit finds the first picture by id order after its tuple moved', async () => {
    const post = gatewayPost({ files: ['a.png', 'b.png'] });
    await listener().onCreate(post);
    const [first] = nonEmpty(await mediaRows(), 'media');
    await testApp.db
      .update(schema.hubMedia)
      .set({ caption: 'moved' })
      .where(eq(schema.hubMedia.id, first.id));
    const rest = [...post.attachments.values()].slice(1);
    const edited = { ...post, attachments: { values: () => rest } };
    await ingest().onEdit(toPostLike(edited), await hubRef());
    const [, second] = await mediaRows();
    expect((await deathRows()).map((d) => [d.source, d.hubMediaId])).toEqual([
      ['discord', second?.id],
    ]);
  });

  it('a re-delivered post whose picture is a tombstone links no death to it', async () => {
    const post = gatewayPost();
    await listener().onCreate(post);
    await ingest().onDelete(post.id, await hubRef());
    const summary = await ingest().ingestPost(toPostLike(post), await hubRef());
    expect(summary).toMatchObject({
      duplicates: 1,
      deathsLinked: 0,
      deathsInferred: 0,
    });
    expect(await deathRows()).toEqual([]);
  });
});

describe('unbound channel', () => {
  it('ignores a post in a channel no hub feeds from', async () => {
    await listener().onCreate(gatewayPost({ channel: snowflake() }));
    expect(await mediaRows()).toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });
});

async function user(name: string, role: 'member' | 'operator' = 'member') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  const token = await signTestAccessToken(testApp, {
    sub: u.id,
    username: name,
  });
  return { id: u.id, token };
}

async function member(name: string): Promise<string> {
  const u = await user(name);
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId: hubId,
    userId: u.id,
    source: 'manual',
    joinedAt: new Date(),
  });
  return u.token;
}

function readable(id: string): void {
  jest
    .spyOn(testApp.app.get(ChannelMirrorService), 'listReadableTextChannels')
    .mockReturnValue({
      connected: true,
      channels: [{ id, name: 'screenshots', visibility: 'public' }],
    });
}

/** A second game_server hub (another Pelican server) for the bind race. */
async function secondHubId(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.slug, VALHEIM_GAME_SLUG)),
    'game',
  );
  const s = fakeServer(1942);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: g.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server 2',
  );
  return ensureFixtureHubId(testApp.db, row.id, g.id);
}

describe('guilds/:id/media-channel routes (D2)', () => {
  const route = () => `/guilds/${hubId}/media-channel`;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('lets the Leader (operator) bind, read and then ingest from the channel', async () => {
    const op = (await user('op', 'operator')).token;
    const next = snowflake();
    readable(next);
    const put = await testApp.request
      .put(route())
      .set(auth(op))
      .send({ channelId: next });
    const got = await testApp.request.get(route()).set(auth(op));
    expect([put.status, got.status]).toEqual([200, 200]);
    expect(got.body).toMatchObject({
      channelId: next,
      channelName: 'screenshots',
    });
    await listener().onCreate(gatewayPost({ channel: next }));
    expect(await mediaRows()).toHaveLength(1);
  });

  it('unbinding stops ingest from the old channel at once', async () => {
    const op = (await user('op', 'operator')).token;
    await resolver().resolve(channelId); // warm the 60 s cache
    const del = await testApp.request.delete(route()).set(auth(op));
    expect(del.status).toBe(204);
    await listener().onCreate(gatewayPost());
    expect(await mediaRows()).toEqual([]);
  });

  it('refuses a hub member who is not the Leader (GuildLeaderGuard 403)', async () => {
    const t = await member('plain');
    readable(snowflake());
    const res = await Promise.all([
      testApp.request.get(route()).set(auth(t)),
      testApp.request.put(route()).set(auth(t)).send({ channelId }),
      testApp.request.delete(route()).set(auth(t)),
    ]);
    expect(res.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(await resolver().resolve(channelId)).not.toBeNull();
  });

  // Decision (ROK-1941 L2c): the spec table said "visitor 404", but these
  // routes carry the same guards as the sibling Discord binding routes
  // (`guild-discord.controller.ts` GET channels / PUT + DELETE channel:
  // jwt + HubVisibleGuard + GuildLeaderGuard). A visitor gets that existing
  // behaviour — 403 on a visible hub, 404 only once the hub is hidden.
  it('refuses a visitor (403) and hides a hidden hub from them (404)', async () => {
    const t = (await user('visitor')).token;
    const visible = await testApp.request.get(route()).set(auth(t));
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));
    const hidden = await testApp.request.get(route()).set(auth(t));
    expect([visible.status, hidden.status, hidden.body.message]).toEqual([
      403,
      404,
      HUB_NOT_FOUND,
    ]);
  });
});

describe('guilds/:id/media-channel concurrent bind (D1)', () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // D1 under the advisory lock: the loser sees the winner's row (409), and
  // the upsert never reaches the partial unique index (a 500).
  it('two hubs binding one channel at once: one 200, one 409, one row bound', async () => {
    const op = (await user('op', 'operator')).token;
    const other = await secondHubId();
    const next = snowflake();
    readable(next);
    const put = (id: number) =>
      testApp.request
        .put(`/guilds/${id}/media-channel`)
        .set(auth(op))
        .send({ channelId: next });
    const res = await Promise.all([put(hubId), put(other)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const bound = await testApp.db
      .select({ guildId: schema.guildProfiles.guildId })
      .from(schema.guildProfiles)
      .where(eq(schema.guildProfiles.mediaChannelId, next));
    expect(bound).toHaveLength(1);
  });
});
