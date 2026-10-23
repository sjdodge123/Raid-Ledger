/**
 * ROK-1930 L4a — `GET plugins/valheim/armory/servers/:serverId/deaths/pins`
 * against a real database: D6 access (member / staff → 200; visitor → the
 * hub 404), only own `Death` pins on the requested world, several characters
 * merged, the 2000 cap, and D13 no SteamID anywhere in the body.
 */
import { eq } from 'drizzle-orm';
import {
  ValheimDeathPinsResponseSchema,
  type ValheimCharacterMessage,
  type ValheimDeathPinsResponse,
  type ValheimMapMessage,
  type ValheimMapPin,
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
import { DEATH_PINS_CAP } from './valheim-deaths-pins.mappers';

const W1 = '1234567890123';
const W2 = '9876543210987';
let testApp: TestApp;
let server: number;
let hubId: number;
let tokens: Record<'member' | 'visitor' | 'operator', string>;
let seq = 0;

const url = (s: number, w: string) =>
  `/plugins/valheim/armory/servers/${s}/deaths/pins?worldUid=${w}`;
const get = (t: string, w = W1, s = server) =>
  testApp.request.get(url(s, w)).set({ Authorization: `Bearer ${t}` });
const pin = (type: string, x: number, shared = false): ValheimMapPin => ({
  type,
  label: '',
  x,
  z: x + 1,
  checked: false,
  shared,
});

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
  await testApp.db.insert(schema.valheimMaps).values({
    pelicanServerId: server,
    steamId,
    playerId,
    worldUid: world,
    profileId: p.id,
    textureSize: map.grid.textureSize,
    pixelSizeMetres: map.grid.pixelSizeMetres,
    explored: map.explored,
    pins,
    gameVersion: '0.220.5',
    capturedAt: at,
  });
  return p.id;
}

/** Every object key in a JSON value, at any depth. */
function allKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
}

async function pinsOf(t: string, w = W1): Promise<ValheimDeathPinsResponse> {
  const res = await get(t, w);
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(allKeys(res.body).filter((k) => /steam/i.test(k))).toEqual([]);
  return ValheimDeathPinsResponseSchema.parse(res.body);
}
const flat = (r: ValheimDeathPinsResponse) =>
  r.pins.map(
    (p) => `${p.characterName}|${p.characterId ?? '-'}|${p.type}|${p.x}`,
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
    visitor: (await makeUser('visitor')).token,
    operator: (await makeUser('operator', 'operator')).token,
  };
});

describe('GET …/deaths/pins — access (D6)', () => {
  it('serves a hub member and a staff non-member', async () => {
    const id = await character('Ragnar', W1, [pin('Death', 10)]);
    const want = [`Ragnar|${id}|Death|10`];
    expect(flat(await pinsOf(tokens.member))).toEqual(want);
    expect(flat(await pinsOf(tokens.operator))).toEqual(want);
  });

  it('answers a signed-in visitor and a hidden hub with the hub 404', async () => {
    await character('Ragnar', W1, [pin('Death', 10)]);
    const visitor = await get(tokens.visitor);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));
    const hidden = await get(tokens.member);
    expect([
      visitor.status,
      visitor.body.message,
      hidden.status,
      hidden.body.message,
    ]).toEqual([404, HUB_NOT_FOUND, 404, HUB_NOT_FOUND]);
  });

  it('400s a missing or malformed worldUid', async () => {
    const res = await testApp.request
      .get(`/plugins/valheim/armory/servers/${server}/deaths/pins`)
      .set({ Authorization: `Bearer ${tokens.member}` });
    const bad = await get(tokens.member, 'abc');
    expect([res.status, bad.status]).toEqual([400, 400]);
  });
});

describe('GET …/deaths/pins — the layer (Q3 = A)', () => {
  it('merges own Death pins from every character on the requested world only', async () => {
    const a = await character('Ragnar', W1, [
      pin('Icon0', 1),
      pin('Death', 2),
      pin('Death', 3, true),
      pin('Bed', 4),
    ]);
    const b = await character('Bjorn', W1, [pin('Death', 5), pin('Death', 6)]);
    await character('Elsewhere', W2, [pin('Death', 7)]);
    const r = await pinsOf(tokens.member);
    expect(r.worldUid).toBe(W1);
    expect(flat(r)).toEqual([
      `Ragnar|${a}|Death|2`,
      `Bjorn|${b}|Death|5`,
      `Bjorn|${b}|Death|6`,
    ]);
    expect(flat(await pinsOf(tokens.member, W2))).toEqual([
      expect.stringMatching(/^Elsewhere\|\d+\|Death\|7$/),
    ]);
  });

  it(`caps the layer at ${DEATH_PINS_CAP} pins`, async () => {
    const many = Array.from({ length: DEATH_PINS_CAP }, (_, i) =>
      pin('Death', i),
    );
    await character('Ragnar', W1, many);
    await character('Bjorn', W1, [pin('Death', 1)]);
    const r = await pinsOf(tokens.member);
    expect(r.pins).toHaveLength(DEATH_PINS_CAP);
    expect(r.pins.filter((p) => p.characterName === 'Bjorn')).toEqual([]);
  });
});
