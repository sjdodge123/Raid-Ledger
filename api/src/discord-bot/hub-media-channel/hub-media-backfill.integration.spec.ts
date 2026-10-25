/**
 * ROK-1941 L3 — the D12 backfill against a real database, with a stubbed
 * `HistoryPort` (no Discord) and the downloader stubbed with a `solidPng`:
 * paging newest first + the 21-day stop, re-runs dedupe, a failed download
 * is counted and the run goes on, a second start while running is a 409,
 * and a death post with no console death infers exactly one death.
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
import {
  HUB_MEDIA_DOWNLOADER,
  type HubMediaDownloader,
} from '../../hub-media/hub-media-download';
import { solidPng } from '../../hub-media/hub-media.testing';
import { discordProvenanceKey } from '../../hub-media/hub-media.types';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import { fakeServer } from '../../plugins/pelican/testing/pelican-fixtures';
import { ensureFixtureHubId } from '../../plugins/valheim/armory/valheim-armory-map-hub.helpers';
import {
  VALHEIM_GAME_SLUG,
  VALHEIM_PLUGIN_ID,
} from '../../plugins/valheim/valheim.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { HubMediaBackfillService } from './hub-media-backfill.service';
import type { HubMediaBackfillSummary } from './hub-media-backfill.types';
import { HubMediaChannelResolver } from './hub-media-channel.queries';
import {
  HubMediaHistorySource,
  type HistoryPort,
} from './hub-media-history.discord';
import type { PostLike } from './hub-media-post.images';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEATH_TEXT = 'Bjorn met their demise! Final moments captured…';

let testApp: TestApp;
let serverId: number;
let hubId: number;
let channelId: string;
let seq = 0;

const snowflake = (): string => {
  seq += 1;
  return `71000000000${String(seq).padStart(7, '0')}`;
};
const backfill = () => testApp.app.get(HubMediaBackfillService);

/** One image post `daysAgo` old (plain data — what the port returns). */
function post(
  daysAgo: number,
  content = 'base at dusk',
  file = 'a.png',
): PostLike {
  const id = snowflake();
  return {
    id,
    channelId,
    authorId: '600000000000000002',
    createdAt: new Date(Date.now() - daysAgo * DAY_MS),
    content,
    attachments: [
      {
        id: `${id}0`,
        url: `https://cdn.discordapp.com/attachments/${channelId}/${id}/${file}`,
        contentType: 'image/png',
        name: file,
      },
    ],
    embeds: [],
  };
}

/** A port serving `pages` in order (then empty pages), recording `before`. */
function stubPort(pages: PostLike[][]): {
  port: HistoryPort;
  befores: (string | undefined)[];
} {
  const befores: (string | undefined)[] = [];
  const port: HistoryPort = {
    fetchBefore: (before) => {
      befores.push(before);
      return Promise.resolve(pages[befores.length - 1] ?? []);
    },
  };
  jest
    .spyOn(testApp.app.get(HubMediaHistorySource), 'open')
    .mockReturnValue(port);
  return { port, befores };
}

/** Start a run and wait for it; the finished summary. */
async function runOnce(): Promise<HubMediaBackfillSummary> {
  await backfill().start(hubId);
  await backfill().settled(hubId);
  const status = backfill().status(hubId);
  expect(status.state).toBe('done');
  return nonEmpty(
    [status.summary].flatMap((s) => (s ? [s] : [])),
    'summary',
  )[0];
}

const mediaKeys = async (): Promise<string[]> =>
  (
    await testApp.db
      .select({ key: schema.hubMedia.provenanceKey })
      .from(schema.hubMedia)
      .where(eq(schema.hubMedia.guildId, hubId))
      .orderBy(asc(schema.hubMedia.id))
  ).map((r) => r.key);

const key = (p: PostLike): string =>
  discordProvenanceKey({
    channelId: p.channelId,
    messageId: p.id,
    attachmentId: `${p.id}0`,
  });

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
  const s = fakeServer(19412);
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

async function bind(channel: string): Promise<void> {
  const set = { mediaChannelId: channel, mediaChannelSetAt: new Date() };
  await testApp.db
    .insert(schema.guildProfiles)
    .values({ guildId: hubId, ...set })
    .onConflictDoUpdate({ target: schema.guildProfiles.guildId, set });
  testApp.app.get(HubMediaChannelResolver).invalidate(channel);
}

beforeAll(async () => {
  process.env.HUB_MEDIA_DIR = await mkdtemp(
    join(tmpdir(), 'hub-media-1941-bf-'),
  );
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
  jest
    .spyOn(downloader, 'download')
    .mockImplementation((url: URL) =>
      url.pathname.endsWith('broken.png')
        ? Promise.reject(new Error('download refused'))
        : Promise.resolve(png),
    );
});

afterEach(async () => {
  await backfill().settled(hubId);
  jest.restoreAllMocks();
});

describe('paging + the 21-day stop (D12)', () => {
  it('pages newest first and never ingests or pages past a 22-day-old message', async () => {
    const p1 = [post(1), post(2)];
    const p2 = [post(3)];
    const p3 = [post(20), post(22), post(23)];
    const beyond = [post(24)];
    const { befores } = stubPort([p1, p2, p3, beyond]);
    const summary = await runOnce();
    expect(befores).toEqual([undefined, p1[1]?.id, p2[0]?.id]);
    expect(await mediaKeys()).toEqual(
      [...p1, ...p2, p3[0]].flatMap((p) => (p ? [key(p)] : [])),
    );
    expect(summary).toMatchObject({
      scanned: 4,
      imagesStored: 4,
      duplicates: 0,
      failed: 0,
      oldestScannedAt: p3[0]?.createdAt.toISOString(),
    });
  });

  it('ends on an empty page when the channel is younger than 21 days', async () => {
    const page = [post(1), post(5)];
    const { befores } = stubPort([page]);
    const summary = await runOnce();
    expect(befores).toEqual([undefined, page[1]?.id]);
    expect(summary.scanned).toBe(2);
  });
});

describe('the app\'s own posts (D4)', () => {
  it('scans the bot\'s own post in the history but never stores it', async () => {
    const OWN_BOT_ID = '600000000000000001';
    jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'getClient')
      .mockReturnValue({ user: { id: OWN_BOT_ID } } as never);
    const own = { ...post(1), authorId: OWN_BOT_ID };
    const webhook = post(2);
    stubPort([[own, webhook]]);
    const summary = await runOnce();
    expect(await mediaKeys()).toEqual([key(webhook)]);
    expect(summary).toMatchObject({ scanned: 2, imagesStored: 1 });
  });
});

describe('re-runs and failures (D12, AC7)', () => {
  it('a second run stores nothing new and counts every image as a duplicate', async () => {
    const page = [post(1), post(2), post(3)];
    stubPort([page]);
    const first = await runOnce();
    stubPort([page]);
    const second = await runOnce();
    expect([first.imagesStored, first.duplicates]).toEqual([3, 0]);
    expect([second.imagesStored, second.duplicates]).toEqual([0, 3]);
    expect(await mediaKeys()).toHaveLength(3);
  });

  it('counts a failed download in `failed` and stores the rest of the run', async () => {
    const page = [post(1), post(2, 'base', 'broken.png'), post(3)];
    stubPort([page]);
    const summary = await runOnce();
    expect(summary).toMatchObject({ scanned: 3, imagesStored: 2, failed: 1 });
    expect(await mediaKeys()).toEqual(
      [page[0], page[2]].flatMap((p) => (p ? [key(p)] : [])),
    );
  });

  it('infers exactly one discord death from a death post across two runs', async () => {
    const page = [post(1, DEATH_TEXT, 'Bjorn_2026-10-20_12-00-00.png')];
    stubPort([page]);
    const first = await runOnce();
    stubPort([page]);
    const second = await runOnce();
    const deaths = await testApp.db
      .select({ source: schema.valheimPlayerDeaths.source })
      .from(schema.valheimPlayerDeaths)
      .where(eq(schema.valheimPlayerDeaths.pelicanServerId, serverId));
    expect([first.deathsInferred, second.deathsInferred]).toEqual([1, 0]);
    expect(deaths).toEqual([{ source: 'discord' }]);
  });
});

describe('POST/GET guilds/:id/media-channel/backfill (D2)', () => {
  const route = () => `/guilds/${hubId}/media-channel/backfill`;

  async function operatorAuth(): Promise<{ Authorization: string }> {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: 'local:op', username: 'op', role: 'operator' })
        .returning({ id: schema.users.id }),
      'operator',
    );
    const token = await signTestAccessToken(testApp, {
      sub: u.id,
      username: 'op',
    });
    return { Authorization: `Bearer ${token}` };
  }

  it('answers 409 with the running job while one runs, then GET shows the summary', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const page = [post(1)];
    const port: HistoryPort = {
      fetchBefore: async (before) => {
        await gate;
        return before === undefined ? page : [];
      },
    };
    jest
      .spyOn(testApp.app.get(HubMediaHistorySource), 'open')
      .mockReturnValue(port);
    const auth = await operatorAuth();
    const first = await testApp.request.post(route()).set(auth);
    const second = await testApp.request.post(route()).set(auth);
    release();
    await backfill().settled(hubId);
    const got = await testApp.request.get(route()).set(auth);
    expect([first.status, second.status, got.status]).toEqual([202, 409, 200]);
    expect(first.body).toMatchObject({ state: 'running' });
    expect(second.body).toMatchObject({ job: { state: 'running' } });
    expect(got.body).toMatchObject({
      state: 'done',
      summary: { scanned: 1, imagesStored: 1 },
    });
  });

  it('refuses a start with 400 when the hub has no pictures channel', async () => {
    await testApp.db
      .update(schema.guildProfiles)
      .set({ mediaChannelId: null })
      .where(eq(schema.guildProfiles.guildId, hubId));
    const res = await testApp.request.post(route()).set(await operatorAuth());
    expect(res.status).toBe(400);
  });
});
