/**
 * ROK-1930 L2 — `GET plugins/valheim/armory/servers/:serverId/deaths`
 * against a real database: D6 access (member / staff → 200; visitor,
 * hidden hub, unknown server → the hub 404), D7 grouping + NULL-steam
 * resolution, D9 `characterId`, the sort and `since`; D13 no SteamID
 * anywhere in the body and a stable, unique `key` per bar.
 */
import { eq } from 'drizzle-orm';
import {
  ValheimDeathsResponseSchema,
  type ValheimCharacterMessage,
  type ValheimDeathsResponse,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';

const A = '76561198000000001';
const B = '76561198000000002';
const C = '76561198000000003';
let testApp: TestApp;
let server: number;
let hubId: number;
let tokens: Record<'member' | 'visitor' | 'operator', string>;
let seq = 0;

const url = (s: number) => `/plugins/valheim/armory/servers/${s}/deaths`;
const get = (s: number, t: string) =>
  testApp.request.get(url(s)).set({ Authorization: `Bearer ${t}` });
const hour = (h: number) => new Date(Date.UTC(2026, 9, 20, h));

async function makeUser(name: string, role: 'member' | 'operator' = 'member') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  return signTestAccessToken(testApp, { sub: u.id, username: name });
}

async function makeMember(name: string): Promise<string> {
  const token = await makeUser(name);
  const [u] = nonEmpty(
    await testApp.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, name)),
    `member ${name}`,
  );
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId: hubId,
    userId: u.id,
    source: 'manual',
    joinedAt: new Date(),
  });
  return token;
}

async function death(characterName: string, steamId: string | null, h: number) {
  seq += 1;
  await testApp.db.insert(schema.valheimPlayerDeaths).values({
    pelicanServerId: server,
    characterName,
    steamId,
    source: 'log',
    loggedAt: `10/20/2026 ${String(h).padStart(2, '0')}:00:${String(seq % 60).padStart(2, '0')}`,
    occurredAt: hour(h),
  });
}

async function profile(steamId: string, name: string, capturedH: number) {
  seq += 1;
  const ch = loadValheimFixture(
    'character-vanilla',
  ) as unknown as ValheimCharacterMessage;
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
        capturedAt: hour(capturedH),
        equipment: ch.equipment,
        inventory: ch.inventory,
        skills: ch.skills,
        trophies: [],
        knownItems: [],
        knownRecipes: [],
      })
      .returning({ id: schema.valheimProfiles.id }),
    'profile',
  );
  return row.id;
}

/** Every object key in a JSON value, at any depth. */
function allKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
}

async function deathsOf(t: string): Promise<ValheimDeathsResponse> {
  const res = await get(server, t);
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(allKeys(res.body).filter((k) => /steam/i.test(k))).toEqual([]);
  // D13: no seeded SteamID anywhere in the body — a `key` value included.
  expect([A, B, C].filter((id) => res.text.includes(id))).toEqual([]);
  return ValheimDeathsResponseSchema.parse(res.body);
}
const bars = (r: ValheimDeathsResponse) =>
  r.players.map(
    (p) => `${p.name}|${p.key}|${p.deaths}|${p.characterId ?? '-'}`,
  );

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
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(1);
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
  server = row.id;
  hubId = await ensureFixtureHubId(testApp.db, server, g.id);
  tokens = {
    member: await makeMember('member'),
    visitor: await makeUser('visitor'),
    operator: await makeUser('operator', 'operator'),
  };
});

describe('GET …/servers/:serverId/deaths — access (D6)', () => {
  it('serves a hub member and a staff non-member', async () => {
    await death('Ragnar', A, 1);
    expect(bars(await deathsOf(tokens.member))).toEqual(['Ragnar|nRagnar|1|-']);
    expect(bars(await deathsOf(tokens.operator))).toEqual([
      'Ragnar|nRagnar|1|-',
    ]);
  });

  it('answers a signed-in visitor with the hub 404', async () => {
    await death('Ragnar', A, 1);
    const res = await get(server, tokens.visitor);
    expect({ status: res.status, message: res.body.message }).toEqual({
      status: 404,
      message: HUB_NOT_FOUND,
    });
  });

  it('answers a member of a hidden hub, and an unknown server, with the hub 404', async () => {
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));
    const hidden = await get(server, tokens.member);
    const unknown = await get(server + 999, tokens.operator);
    expect([
      hidden.status,
      hidden.body.message,
      unknown.status,
      unknown.body.message,
    ]).toEqual([404, HUB_NOT_FOUND, 404, HUB_NOT_FOUND]);
  });
});

describe('GET …/servers/:serverId/deaths — counts (D7/D9)', () => {
  it('returns players: [] and since: null with no deaths', async () => {
    expect(await deathsOf(tokens.member)).toEqual({ players: [], since: null });
  });

  it('sorts by deaths desc and reports since = the earliest death', async () => {
    await death('Bjorn', B, 3);
    for (const h of [2, 4, 5]) await death('Ragnar', A, h);
    await death('Cyra', C, 6);
    await death('Bjorn', B, 7);
    const r = await deathsOf(tokens.member);
    expect(bars(r)).toEqual([
      'Ragnar|nRagnar|3|-',
      'Bjorn|nBjorn|2|-',
      'Cyra|nCyra|1|-',
    ]);
    expect(r.since).toBe(hour(2).toISOString());
  });

  it('folds a NULL-steam death into the one same-name profile and links its newest character', async () => {
    const older = await profile(A, 'Ragnar', 1);
    const newer = await profile(A, 'Ragnar2', 9);
    await death('Ragnar', A, 2);
    await death('Ragnar', null, 3);
    const r = await deathsOf(tokens.member);
    expect(bars(r)).toEqual([`Ragnar|c${newer}|2|${newer}`]);
    expect(r.players[0]?.characterId).not.toBe(older);
  });

  it('keeps a NULL-steam death name-only when two profiles share the name', async () => {
    await profile(A, 'Twin', 1);
    await profile(B, 'Twin', 1);
    await death('Twin', null, 2);
    expect(bars(await deathsOf(tokens.member))).toEqual(['Twin|nTwin|1|-']);
  });

  it('counts only this server and still shows players with no hub membership', async () => {
    await death('Ragnar', A, 1);
    const s2 = fakeServer(2);
    const [other] = nonEmpty(
      await testApp.db
        .insert(schema.pelicanServers)
        .values({
          panelUuid: s2.uuid,
          identifier: s2.identifier,
          name: s2.name,
        })
        .returning({ id: schema.pelicanServers.id }),
      'server 2',
    );
    await testApp.db.insert(schema.valheimPlayerDeaths).values({
      pelicanServerId: other.id,
      characterName: 'Elsewhere',
      steamId: B,
      source: 'log',
      loggedAt: '10/20/2026 01:00:00',
      occurredAt: hour(1),
    });
    expect(bars(await deathsOf(tokens.member))).toEqual(['Ragnar|nRagnar|1|-']);
  });
});

describe('GET …/servers/:serverId/deaths — opaque keys (D13)', () => {
  it('gives every bar a unique key that holds across reads as counts change', async () => {
    const id = await profile(A, 'Ragnar', 1);
    await death('Ragnar', A, 2);
    await death('Sam', B, 3);
    await death('Sam', null, 4);
    const keysOf = (r: ValheimDeathsResponse) =>
      r.players.map((p) => p.key).sort();
    const first = await deathsOf(tokens.member);
    expect(new Set(first.players.map((p) => p.key)).size).toBe(
      first.players.length,
    );
    for (const h of [5, 6, 7]) await death('Sam', null, h);
    const second = await deathsOf(tokens.member);
    expect(bars(second)).toEqual([
      'Sam|nSam~2|4|-',
      'Sam|nSam|1|-',
      `Ragnar|c${id}|1|${id}`,
    ]);
    expect(keysOf(second)).toEqual(keysOf(first));
  });
});
