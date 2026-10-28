/**
 * ROK-2027 — the Gallery list scoped to one Deaths bar, end to end against a
 * real database: `GET /hubs/:guildId/media?subject=valheim-death:<bar key>`
 * returns only that bar's death pictures (character key and name-only key),
 * `total` matches the bar's `pictureCount` for a member, the cursor pages
 * stay scoped, core visibility still applies (hidden → editors only, removed
 * and other-hub never), and the 400 / empty-page edges of the core filter:
 * unknown namespace, malformed subject, resolver refusal, Valheim plugin
 * inactive, stale key, and a hub whose server is not Valheim.
 */
import {
  HubMediaListResponseSchema,
  ValheimDeathsResponseSchema,
  type HubMediaListResponse,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';

type Who = 'member' | 'operator';
const A = '76561198000000001';
const B = '76561198000000002';
let testApp: TestApp;
let server: number;
let hubId: number;
let otherHubId: number;
let tokens: Record<Who, string>;
let seq = 0;

const hour = (h: number) => new Date(Date.UTC(2026, 9, 20, h));
const auth = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });
const listPath = (g: number, qs: Record<string, string>) =>
  `/hubs/${g}/media?${new URLSearchParams(qs).toString()}`;
const rawList = (g: number, qs: Record<string, string>, who: Who = 'member') =>
  testApp.request.get(listPath(g, qs)).set(auth(who));

async function list(
  qs: Record<string, string>,
  who: Who = 'member',
  g = hubId,
): Promise<HubMediaListResponse> {
  const res = await rawList(g, qs, who);
  expect(res.status).toBe(200);
  return HubMediaListResponseSchema.parse(res.body);
}
const ids = (r: HubMediaListResponse) => r.items.map((i) => i.id);
const subject = (key: string) => ({ subject: `valheim-death:${key}` });

async function makeUser(name: string, role: 'member' | 'operator') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  return {
    id: u.id,
    token: await signTestAccessToken(testApp, { sub: u.id, username: name }),
  };
}

async function makeServer(n: number, gameId: number): Promise<number> {
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId,
      })
      .returning({ id: schema.pelicanServers.id }),
    `server ${n}`,
  );
  return row.id;
}

async function makeGame(name: string, slug: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug })
      .returning({ id: schema.games.id }),
    `game ${slug}`,
  );
  return g.id;
}

async function profile(steamId: string, name: string): Promise<number> {
  seq += 1;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.valheimProfiles)
      .values({
        pelicanServerId: server,
        steamId,
        playerId: String(1000000000000000 + seq),
        worldUid: '1234567890123',
        worldName: 'W',
        name,
        gameVersion: '0.220.5',
        modVersion: '1.0.0',
        capturedAt: hour(0),
        equipment: [],
        inventory: { grid: { width: 8, height: 4, extraRows: [] }, items: [] },
        skills: [],
        trophies: [],
        knownItems: [],
        knownRecipes: [],
      })
      .returning({ id: schema.valheimProfiles.id }),
    'profile',
  );
  return row.id;
}

async function media(
  h: number,
  state: { hiddenAt?: Date; removedAt?: Date; guildId?: number } = {},
): Promise<number> {
  seq += 1;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.hubMedia)
      .values({
        guildId: hubId,
        source: 'discord',
        kind: 'death',
        provenanceKey: `discord:1:${seq}:1`,
        capturedAt: hour(h),
        storageName: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
        width: 640,
        height: 480,
        bytes: 1000,
        ...state,
      })
      .returning({ id: schema.hubMedia.id }),
    'media',
  );
  return row.id;
}

/** A death of `name` at hour `h`, linked to `hubMediaId` when given. */
async function death(
  name: string,
  steamId: string | null,
  h: number,
  hubMediaId?: number,
) {
  seq += 1;
  await testApp.db.insert(schema.valheimPlayerDeaths).values({
    pelicanServerId: server,
    characterName: name,
    steamId,
    source: 'log',
    loggedAt: `2026-10-20T${String(h).padStart(2, '0')}:00:${String(seq % 60).padStart(2, '0')}`,
    occurredAt: hour(h),
    ...(hubMediaId === undefined ? {} : { hubMediaId }),
  });
}

/** The Deaths widget's bar for `name`, as a member sees it. */
async function barOf(name: string) {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/servers/${server}/deaths`)
    .set(auth('member'));
  expect(res.status).toBe(200);
  const bar = ValheimDeathsResponseSchema.parse(res.body).players.find(
    (p) => p.name === name,
  );
  if (!bar) throw new Error(`no Deaths bar for ${name}`);
  return bar;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  const registry = testApp.app.get(PluginRegistryService);
  for (const slug of [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID]) {
    await registry.ensureInstalled(slug);
    await registry.activate(slug);
  }
  const valheimGame = await makeGame('Valheim', VALHEIM_GAME_SLUG);
  server = await makeServer(1, valheimGame);
  hubId = await ensureFixtureHubId(testApp.db, server, valheimGame);
  // A second hub whose Pelican server runs another game.
  const otherGame = await makeGame('Enshrouded', 'enshrouded');
  const otherServer = await makeServer(2, otherGame);
  otherHubId = await ensureFixtureHubId(testApp.db, otherServer, otherGame);
  const member = await makeUser('member', 'member');
  for (const g of [hubId, otherHubId]) {
    await testApp.db.insert(schema.hubServerMembers).values({
      guildId: g,
      userId: member.id,
      source: 'manual',
      joinedAt: new Date(),
    });
  }
  tokens = {
    member: member.token,
    operator: (await makeUser('operator', 'operator')).token,
  };
});

/** Callahan (profiled → `c<id>`) with 3 pictures, Bjorn (name-only) with 1. */
async function seedTwoPlayers() {
  const callahanId = await profile(A, 'Callahan');
  const c = [await media(1), await media(2), await media(3)];
  for (const [i, m] of c.entries()) await death('Callahan', A, i + 1, m);
  await death('Callahan', A, 4);
  const bjorn = await media(5);
  await death('Bjorn', null, 5, bjorn);
  await death('Eira', B, 6, await media(6));
  const unlinked = await media(7);
  return { callahanKey: `c${callahanId}`, callahan: c, bjorn, unlinked };
}

describe('GET /hubs/:guildId/media?subject=valheim-death:<key> — scope (ROK-2027)', () => {
  it("returns only the character bar's pictures, newest first, total == the bar's pictureCount", async () => {
    const s = await seedTwoPlayers();
    const r = await list(subject(s.callahanKey));
    expect({ ids: ids(r), total: r.total }).toEqual({
      ids: [...s.callahan].reverse(),
      total: (await barOf('Callahan')).pictureCount,
    });
    expect(r.total).toBe(3);
  });

  it('scopes a name-only bar by its n<name> key', async () => {
    const s = await seedTwoPlayers();
    const r = await list(subject('nBjorn'));
    expect({ ids: ids(r), total: r.total }).toEqual({
      ids: [s.bjorn],
      total: 1,
    });
  });

  it('leaves the list unchanged without a subject', async () => {
    const s = await seedTwoPlayers();
    const r = await list({});
    expect(r.total).toBe(6);
    expect(ids(r)).toContain(s.unlinked);
  });

  it('pages the scoped set with limit + cursor and ends', async () => {
    const s = await seedTwoPlayers();
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const qs: Record<string, string> = {
        ...subject(s.callahanKey),
        limit: '1',
      };
      if (cursor !== null) qs.cursor = cursor;
      const r = await list(qs);
      expect(r.total).toBe(3);
      seen.push(...ids(r));
      cursor = r.nextCursor;
      if (cursor === null) break;
    }
    expect({ seen, cursor }).toEqual({
      seen: [...s.callahan].reverse(),
      cursor: null,
    });
  });
});

describe('GET /hubs/:guildId/media?subject=… — core visibility still applies (ROK-2027 D4)', () => {
  it('shows a hidden picture to an editor (flagged) but not to a member; never a removed one', async () => {
    const callahanKey = `c${await profile(A, 'Callahan')}`;
    const shown = await media(1);
    const hidden = await media(2, { hiddenAt: hour(9) });
    await death('Callahan', A, 1, shown);
    await death('Callahan', A, 2, hidden);
    await death('Callahan', A, 3, await media(3, { removedAt: hour(9) }));
    const asMember = await list(subject(callahanKey), 'member');
    expect({ ids: ids(asMember), total: asMember.total }).toEqual({
      ids: [shown],
      total: 1,
    });
    const asEditor = await list(subject(callahanKey), 'operator');
    expect(asEditor.items.map((i) => `${i.id}:${i.hidden}`)).toEqual([
      `${hidden}:true`,
      `${shown}:false`,
    ]);
  });

  it("never lists another hub's picture even when a death links it", async () => {
    const callahanKey = `c${await profile(A, 'Callahan')}`;
    const own = await media(1);
    await death('Callahan', A, 1, own);
    await death('Callahan', A, 2, await media(2, { guildId: otherHubId }));
    const r = await list(subject(callahanKey));
    expect({ ids: ids(r), total: r.total }).toEqual({ ids: [own], total: 1 });
  });
});

describe('GET /hubs/:guildId/media?subject=… — edges (ROK-2027 D5/D6)', () => {
  it('answers 400 "Invalid query" for an unknown namespace, a malformed subject or a refused key', async () => {
    await seedTwoPlayers();
    const bad = [
      'other-plugin:c1',
      'valheim-death',
      'Valheim-death:c1',
      'valheim-death:x42',
    ];
    const out = await Promise.all(
      bad.map((s) => rawList(hubId, { subject: s })),
    );
    expect(out.map((r) => `${r.status} ${String(r.body.message)}`)).toEqual(
      bad.map(() => '400 Invalid query'),
    );
  });

  it('answers 400 while the Valheim plugin is inactive, and 200 again once re-activated', async () => {
    const s = await seedTwoPlayers();
    const registry = testApp.app.get(PluginRegistryService);
    await registry.deactivate(VALHEIM_PLUGIN_ID);
    expect((await rawList(hubId, subject(s.callahanKey))).status).toBe(400);
    await registry.activate(VALHEIM_PLUGIN_ID);
    expect((await list(subject(s.callahanKey))).total).toBe(3);
  });

  it('answers a stale but well-formed key with an empty page, total 0', async () => {
    await seedTwoPlayers();
    const r = await list(subject('nNobody'));
    expect({
      items: r.items,
      total: r.total,
      nextCursor: r.nextCursor,
    }).toEqual({
      items: [],
      total: 0,
      nextCursor: null,
    });
  });

  it('answers an empty page on a hub whose server is not Valheim', async () => {
    const s = await seedTwoPlayers();
    await media(1, { guildId: otherHubId });
    const r = await list(subject(s.callahanKey), 'member', otherHubId);
    expect({ items: r.items, total: r.total }).toEqual({ items: [], total: 0 });
  });
});
