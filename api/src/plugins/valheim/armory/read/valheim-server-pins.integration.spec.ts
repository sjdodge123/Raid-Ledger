/**
 * ROK-1943 — `GET plugins/valheim/armory/servers/:serverId/pins` against a
 * real database: D6 access (member / staff → 200; visitor, hidden hub, no
 * hub → the hub 404), the 400s, own pins only (no cartography copies) on the
 * requested world, the `players` / `types` filters, the 2000 cap +
 * `truncated`, unlinked maps, and D13 no SteamID anywhere in the body.
 */
import { eq } from 'drizzle-orm';
import {
  VALHEIM_SERVER_PINS_CAP,
  VALHEIM_SERVER_PINS_PLAYERS_MAX,
  VALHEIM_SERVER_PINS_TYPES_MAX,
  ValheimServerPinsResponseSchema,
  type ValheimCharacterMessage,
  type ValheimMapMessage,
  type ValheimMapPin,
  type ValheimServerPinsResponse,
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

const W1 = '1234567890123';
const W2 = '9876543210987';
let testApp: TestApp;
let server: number;
let hubId: number;
let gameId: number;
let tokens: Record<'member' | 'visitor' | 'operator', string>;
let seq = 0;
/** Every SteamID `character()` seeded, for the D13 body-text check. */
const seededSteamIds: string[] = [];

const base = (s: number) => `/plugins/valheim/armory/servers/${s}/pins`;
/** GET the layer; `qs` is the raw query string (worldUid included by caller). */
const get = (t: string, qs = `worldUid=${W1}`, s = server) =>
  testApp.request.get(`${base(s)}?${qs}`).set({ Authorization: `Bearer ${t}` });
const pin = (
  type: string,
  x: number,
  shared = false,
  checked = false,
): ValheimMapPin => ({ type, label: `L${x}`, x, z: x + 1, checked, shared });

async function makeUser(name: string, role: 'member' | 'operator' = 'member') {
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

async function makeMember(name: string): Promise<string> {
  const u = await makeUser(name);
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId: hubId,
    userId: u.id,
    source: 'manual',
    joinedAt: new Date(),
  });
  return u.token;
}

/** A character (profile) with one map on `world`; returns the profile id. */
async function character(name: string, world: string, pins: ValheimMapPin[]) {
  seq += 1;
  const steamId = `7656119800000${String(seq).padStart(4, '0')}`;
  seededSteamIds.push(steamId);
  const playerId = String(1000000000000000 + seq);
  const ch = loadValheimFixture(
    'character-vanilla',
  ) as unknown as ValheimCharacterMessage;
  const map = loadValheimFixture(
    'map-personal',
  ) as unknown as ValheimMapMessage;
  const at = new Date(Date.UTC(2026, 9, 20, 1));
  const [p] = nonEmpty(
    await testApp.db
      .insert(schema.valheimProfiles)
      .values({
        pelicanServerId: server,
        steamId,
        playerId,
        worldUid: world,
        worldName: 'W',
        name,
        gameVersion: '0.220.5',
        modVersion: '1.0.0',
        capturedAt: at,
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
  await insertMap({ steamId, playerId, world, profileId: p.id, pins, map });
  return p.id;
}

/** One `valheim_maps` row; `profileId: null` = a map whose profile never landed. */
async function insertMap(o: {
  steamId: string;
  playerId: string;
  world: string;
  profileId: number | null;
  pins: ValheimMapPin[];
  map?: ValheimMapMessage;
}) {
  const map =
    o.map ??
    (loadValheimFixture('map-personal') as unknown as ValheimMapMessage);
  await testApp.db.insert(schema.valheimMaps).values({
    pelicanServerId: server,
    steamId: o.steamId,
    playerId: o.playerId,
    worldUid: o.world,
    profileId: o.profileId,
    textureSize: map.grid.textureSize,
    pixelSizeMetres: map.grid.pixelSizeMetres,
    explored: map.explored,
    pins: o.pins,
    gameVersion: '0.220.5',
    capturedAt: new Date(Date.UTC(2026, 9, 20, 1)),
  });
}

/** Every object key in a JSON value, at any depth. */
function allKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
}

async function pinsOf(
  t: string,
  qs = `worldUid=${W1}`,
): Promise<ValheimServerPinsResponse> {
  const res = await get(t, qs);
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(allKeys(res.body).filter((k) => /steam/i.test(k))).toEqual([]);
  // D13: no seeded SteamID anywhere in the body, as a value or a key.
  expect(seededSteamIds.filter((id) => res.text.includes(id))).toEqual([]);
  return ValheimServerPinsResponseSchema.parse(res.body);
}
const flat = (r: ValheimServerPinsResponse) =>
  r.pins.map(
    (p) =>
      `${p.characterName}|${p.characterId ?? '-'}|${p.type}|${p.x}|${p.label}|${p.checked}`,
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
  gameId = g.id;
  hubId = await ensureFixtureHubId(testApp.db, server, g.id);
  tokens = {
    member: await makeMember('member'),
    visitor: (await makeUser('visitor')).token,
    operator: (await makeUser('operator', 'operator')).token,
  };
});

/** A second Valheim server with no hub row. */
async function serverWithoutHub(): Promise<number> {
  const s = fakeServer(2);
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
    'hubless server',
  );
  return row.id;
}

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => String(i + 1)).join(',');
const typeList = (n: number) =>
  Array.from({ length: n }, (_, i) => `T${i}`).join(',');

describe('GET …/servers/:id/pins — access (D6, S1)', () => {
  it('serves a hub member and a staff non-member', async () => {
    const id = await character('Ragnar', W1, [pin('Bed', 10)]);
    const want = [`Ragnar|${id}|Bed|10|L10|false`];
    expect(flat(await pinsOf(tokens.member))).toEqual(want);
    expect(flat(await pinsOf(tokens.operator))).toEqual(want);
  });

  it('answers a visitor, a hidden hub and a hubless server with the hub 404', async () => {
    await character('Ragnar', W1, [pin('Bed', 10)]);
    const hubless = await get(
      tokens.member,
      `worldUid=${W1}`,
      await serverWithoutHub(),
    );
    const visitor = await get(tokens.visitor);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));
    const hidden = await get(tokens.member);
    expect(
      [visitor, hidden, hubless].map((r) => [r.status, r.body.message]),
    ).toEqual([
      [404, HUB_NOT_FOUND],
      [404, HUB_NOT_FOUND],
      [404, HUB_NOT_FOUND],
    ]);
  });
});

describe('GET …/servers/:id/pins — 400s (S2)', () => {
  const cases: [string, string][] = [
    ['', 'Invalid worldUid'],
    ['worldUid=abc', 'Invalid worldUid'],
    [`worldUid=${W1}&players=`, 'Invalid players'],
    [`worldUid=${W1}&players=0`, 'Invalid players'],
    [`worldUid=${W1}&players=a`, 'Invalid players'],
    [
      `worldUid=${W1}&players=${ids(VALHEIM_SERVER_PINS_PLAYERS_MAX + 1)}`,
      'Invalid players',
    ],
    [`worldUid=${W1}&types=`, 'Invalid types'],
    [`worldUid=${W1}&types=Bad-Type`, 'Invalid types'],
    [
      `worldUid=${W1}&types=${typeList(VALHEIM_SERVER_PINS_TYPES_MAX + 1)}`,
      'Invalid types',
    ],
  ];
  it.each(cases)('?%s → 400 %s', async (qs, message) => {
    const res = await get(tokens.member, qs);
    expect([res.status, res.body.message]).toEqual([400, message]);
  });
});

describe('GET …/servers/:id/pins — the layer', () => {
  it('S3: own pins of every type on the requested world only, label + checked kept, map id order', async () => {
    const a = await character('Ragnar', W1, [
      pin('Bed', 1),
      pin('Death', 2, false, true),
      pin('Icon4', 3, true),
    ]);
    const b = await character('Bjorn', W1, [
      pin('Bed', 4),
      pin('Death', 5),
      pin('Bed', 6, true),
    ]);
    await character('Elsewhere', W2, [pin('Death', 7)]);
    const r = await pinsOf(tokens.member);
    expect([r.worldUid, r.truncated]).toEqual([W1, false]);
    expect(flat(r)).toEqual([
      `Ragnar|${a}|Bed|1|L1|false`,
      `Ragnar|${a}|Death|2|L2|true`,
      `Bjorn|${b}|Bed|4|L4|false`,
      `Bjorn|${b}|Death|5|L5|false`,
    ]);
  });

  it('S4: players narrows to the named characters; an id with no map on the world adds nothing', async () => {
    const a = await character('Ragnar', W1, [pin('Bed', 1)]);
    const b = await character('Bjorn', W1, [pin('Bed', 2)]);
    const elsewhere = await character('Elsewhere', W2, [pin('Bed', 3)]);
    const only = (qs: string) => pinsOf(tokens.member, `worldUid=${W1}&${qs}`);
    expect(flat(await only(`players=${a}`))).toEqual([
      `Ragnar|${a}|Bed|1|L1|false`,
    ]);
    expect(flat(await only(`players=${b},${a}`))).toEqual([
      `Ragnar|${a}|Bed|1|L1|false`,
      `Bjorn|${b}|Bed|2|L2|false`,
    ]);
    expect(flat(await only(`players=${elsewhere},999999`))).toEqual([]);
  });

  it('S5: types narrows to the named raw types', async () => {
    const a = await character('Ragnar', W1, [
      pin('Bed', 1),
      pin('Death', 2),
      pin('Icon4', 3),
      pin('Icon3', 4),
    ]);
    const r = await pinsOf(tokens.member, `worldUid=${W1}&types=Death,Icon4`);
    expect(flat(r)).toEqual([
      `Ragnar|${a}|Death|2|L2|false`,
      `Ragnar|${a}|Icon4|3|L3|false`,
    ]);
  });
});

describe('GET …/servers/:id/pins — cap and unlinked maps', () => {
  it(`S6: caps at ${VALHEIM_SERVER_PINS_CAP} pins with truncated:true; exactly the cap is not truncated`, async () => {
    const many = Array.from({ length: VALHEIM_SERVER_PINS_CAP }, (_, i) =>
      pin('Bed', i),
    );
    await character('Ragnar', W1, many);
    const exact = await pinsOf(tokens.member);
    expect([exact.pins.length, exact.truncated]).toEqual([
      VALHEIM_SERVER_PINS_CAP,
      false,
    ]);
    await character('Bjorn', W1, [pin('Bed', 1)]);
    const over = await pinsOf(tokens.member);
    expect([over.pins.length, over.truncated]).toEqual([
      VALHEIM_SERVER_PINS_CAP,
      true,
    ]);
    expect(over.pins.filter((p) => p.characterName === 'Bjorn')).toEqual([]);
  });

  it('S8: an unlinked map is "Unknown character" with a null id, only when players is omitted', async () => {
    const a = await character('Ragnar', W1, [pin('Bed', 1)]);
    await insertMap({
      steamId: '76561198000099999',
      playerId: '1000000000099999',
      world: W1,
      profileId: null,
      pins: [pin('Death', 2)],
    });
    seededSteamIds.push('76561198000099999');
    expect(flat(await pinsOf(tokens.member))).toEqual([
      `Ragnar|${a}|Bed|1|L1|false`,
      'Unknown character|-|Death|2|L2|false',
    ]);
    const named = await pinsOf(tokens.member, `worldUid=${W1}&players=${a}`);
    expect(flat(named)).toEqual([`Ragnar|${a}|Bed|1|L1|false`]);
  });
});
