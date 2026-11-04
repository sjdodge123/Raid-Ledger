/**
 * ROK-1931 S4 (AC-9) — mod-reported deaths on both map pin reads, against a
 * real database. The character snapshot is drained by the armory importer
 * (SQL R stores its reported deaths, as in the S2 spec), then a map row is
 * added for the character and stray reported rows are inserted directly:
 * - `GET …/characters/:id/maps/:mapId` (character scope: reported rows for
 *   (server, steam_id, player_id, world_uid) of that character);
 * - `GET …/servers/:serverId/pins` (reported rows for (server, world_uid)
 *   joined to the profile on (server, steam_id, player_id));
 * - `GET …/characters/:id` carries `deathCount`.
 * D13: no steamId / playerId / worldUid on any pin.
 */
import {
  ValheimCharacterDetailSchema,
  ValheimMapMetaSchema,
  ValheimLinkMessageSchema,
  ValheimServerPinsResponseSchema,
  type ValheimMapMessage,
  type ValheimMapPin,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';

/** `character-deaths.json`: Testviking, world WORLD, deathCount 7. */
const STEAM = '76561198000000001';
const OTHER_STEAM = '76561198000000099';
const PLAYER_ID = '1000000000000001';
const WORLD = '1234567890123';
const FOREIGN_WORLD = '987654321';
/** The fixture's two on-world deaths (SQL R stores both). */
const DEATH_1 = { at: '2026-10-17T20:05:12.000Z', x: -412.5, z: 1210.25 };
const DEATH_2 = { at: '2026-10-15T21:02:33.125Z', x: 1830.125, z: -655 };
/** Testviking's own Death pins: 6 m from DEATH_1 (kept), 5 m from DEATH_2 (dropped). */
const OWN_FAR = pinAt('Death', 'far', DEATH_1.x + 6, DEATH_1.z);
const OWN_NEAR = pinAt('Death', 'mine', DEATH_2.x + 3, DEATH_2.z + 4);
const OWN_BED = pinAt('Bed', 'home', 10, 11);
/** A death of Testviking on another world (inserted directly). */
const FOREIGN = { at: '2026-10-16T18:40:00.500Z', x: 88, z: -96.75 };
/** A death of another SteamID sharing the playerId, on the same world. */
const OTHER = { at: '2026-10-18T09:00:00.000Z', x: 500, z: 501 };

let testApp: TestApp;
let server: number;
let token: string;
const BASE = '/plugins/valheim/armory';
const P = schema.valheimProfiles;
const D = schema.valheimPlayerDeaths;

function pinAt(type: string, label: string, x: number, z: number) {
  const pin: ValheimMapPin = {
    type,
    label,
    x,
    z,
    checked: false,
    shared: false,
  };
  return pin;
}

const get = (url: string) =>
  testApp.request.get(url).set({ Authorization: `Bearer ${token}` });

/** Every object key in a JSON value, at any depth. */
function allKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
}

/** D13: no character key on any pin, and no SteamID/playerId in the body. */
function expectNoIdentity(res: { text: string; body: { pins?: unknown } }) {
  const keys = allKeys(res.body.pins);
  expect(keys.filter((k) => /steam|playerId|worldUid/i.test(k))).toEqual([]);
  expect(
    [STEAM, OTHER_STEAM, PLAYER_ID].filter((id) => res.text.includes(id)),
  ).toEqual([]);
}

async function makeServer(gameId: number): Promise<number> {
  const s = fakeServer(1);
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
    'server',
  );
  return row.id;
}

/** A hub member's token (the server's fixture hub). */
async function memberOf(hubId: number): Promise<string> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'local:member', username: 'member', role: 'member' })
      .returning({ id: schema.users.id }),
    'member',
  );
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId: hubId,
    userId: u.id,
    source: 'manual',
    joinedAt: new Date(),
  });
  return signTestAccessToken(testApp, { sub: u.id, username: 'member' });
}

/** Drain the `character-deaths` snapshot (S2's path); returns the profile id. */
async function importTestviking(): Promise<number> {
  const row = valheimSnapshotRow(
    server,
    ValheimLinkMessageSchema.parse(loadValheimFixture('character-deaths')),
  );
  await testApp.db.insert(schema.valheimLinkSnapshots).values(row);
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
  const [p] = nonEmpty(
    await testApp.db.select({ id: P.id }).from(P).where(eq(P.steamId, STEAM)),
    'Testviking profile',
  );
  return p.id;
}

/**
 * Another SteamID's character on the same world, same playerId; its sheet
 * columns copied from `sheetOf` (only the identity differs).
 */
async function insertOtherProfile(sheetOf: number): Promise<number> {
  const [src] = nonEmpty(
    await testApp.db.select().from(P).where(eq(P.id, sheetOf)),
    'source profile',
  );
  const [p] = nonEmpty(
    await testApp.db
      .insert(P)
      .values({
        pelicanServerId: server,
        steamId: OTHER_STEAM,
        playerId: PLAYER_ID,
        worldUid: WORLD,
        worldName: src.worldName,
        name: 'Otherviking',
        gameVersion: src.gameVersion,
        modVersion: src.modVersion,
        capturedAt: src.capturedAt,
        equipment: src.equipment,
        inventory: src.inventory,
        skills: src.skills,
        trophies: src.trophies,
        knownItems: src.knownItems,
        knownRecipes: src.knownRecipes,
      })
      .returning({ id: P.id }),
    'Otherviking profile',
  );
  return p.id;
}

/** The `map-personal` fixture's explored grid (any valid one will do). */
function fixtureExplored(): ValheimMapMessage['explored'] {
  const msg = ValheimLinkMessageSchema.parse(
    loadValheimFixture('map-personal'),
  );
  if (msg.kind !== 'map') throw new Error(`map-personal is ${msg.kind}`);
  return msg.explored;
}

async function insertMap(
  steamId: string,
  profileId: number,
  pins: ValheimMapPin[],
) {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.valheimMaps)
      .values({
        pelicanServerId: server,
        steamId,
        playerId: PLAYER_ID,
        worldUid: WORLD,
        profileId,
        textureSize: 2048,
        pixelSizeMetres: 12,
        explored: fixtureExplored(),
        pins,
        gameVersion: '0.220.5',
        capturedAt: new Date(Date.UTC(2026, 9, 20, 1)),
      })
      .returning({ id: schema.valheimMaps.id }),
    'map',
  );
  return m.id;
}

/** A stored mod-reported death, as SQL R would write it. */
async function modDeath(
  steamId: string,
  worldUid: string,
  d: { at: string; x: number; z: number },
) {
  await testApp.db.insert(D).values({
    pelicanServerId: server,
    characterName: steamId === STEAM ? 'Testviking' : 'Otherviking',
    steamId,
    playerId: PLAYER_ID,
    worldUid,
    source: 'mod',
    occurredAt: new Date(d.at),
    reportedAt: new Date(d.at),
    x: d.x,
    z: d.z,
  });
}

/** The synthetic pin a reported death becomes (Q6: empty label, diedAt). */
const synthetic = (d: { at: string; x: number; z: number }) => ({
  type: 'Death',
  label: '',
  x: d.x,
  z: d.z,
  checked: false,
  shared: false,
  diedAt: d.at,
});

let ids: { viking: number; other: number; map: number };

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
  server = await makeServer(g.id);
  token = await memberOf(await ensureFixtureHubId(testApp.db, server, g.id));
  const viking = await importTestviking();
  const other = await insertOtherProfile(viking);
  const map = await insertMap(STEAM, viking, [OWN_BED, OWN_FAR, OWN_NEAR]);
  await insertMap(OTHER_STEAM, other, []);
  await modDeath(STEAM, FOREIGN_WORLD, FOREIGN);
  await modDeath(OTHER_STEAM, WORLD, OTHER);
  ids = { viking, other, map };
});

afterEach(async () => {
  const registry = testApp.app.get(PluginRegistryService);
  for (const slug of [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID]) {
    if (registry.isActive(slug)) await registry.deactivate(slug);
  }
});

describe('Valheim reported deaths on map pin reads (integration, ROK-1931 AC-9)', () => {
  it('seeds what the reads assume: two on-world mod rows for Testviking', async () => {
    const stored = await testApp.db
      .select({
        steamId: D.steamId,
        worldUid: D.worldUid,
        reportedAt: D.reportedAt,
      })
      .from(D)
      .where(eq(D.steamId, STEAM));
    expect(
      stored
        .map((r) => `${r.worldUid}|${r.reportedAt?.toISOString() ?? '-'}`)
        .sort(),
    ).toEqual(
      [
        `${WORLD}|${DEATH_1.at}`,
        `${WORLD}|${DEATH_2.at}`,
        `${FOREIGN_WORLD}|${FOREIGN.at}`,
      ].sort(),
    );
  });

  it('character map: own pins, then DEATH_1 as a synthetic pin; DEATH_2 (5 m), the foreign world and the other SteamID are absent', async () => {
    const res = await get(`${BASE}/characters/${ids.viking}/maps/${ids.map}`);
    expect(res.status).toBe(200);
    const meta = ValheimMapMetaSchema.parse(res.body);
    expect(meta.pins).toEqual([OWN_BED, OWN_FAR, OWN_NEAR, synthetic(DEATH_1)]);
    expectNoIdentity(res);
  });

  it('character detail carries the mod-reported deathCount', async () => {
    const res = await get(`${BASE}/characters/${ids.viking}`);
    expect(res.status).toBe(200);
    expect(ValheimCharacterDetailSchema.parse(res.body).deathCount).toBe(7);
    expectNoIdentity(res);
  });
});

describe('Valheim reported deaths on the server pins read (integration, ROK-1931 AC-9)', () => {
  it('server pins: each death under its own character; DEATH_2 (5 m) and the foreign world absent', async () => {
    const res = await get(`${BASE}/servers/${server}/pins?worldUid=${WORLD}`);
    expect(res.status).toBe(200);
    const body = ValheimServerPinsResponseSchema.parse(res.body);
    const deaths = body.pins
      .filter((p) => p.type === 'Death')
      .map(
        (p) =>
          `${p.characterName}|${p.characterId ?? '-'}|${p.x}|${p.z}|${p.label}|${p.diedAt ?? '-'}`,
      )
      .sort();
    expect(deaths).toEqual(
      [
        `Testviking|${ids.viking}|${OWN_FAR.x}|${OWN_FAR.z}|far|-`,
        `Testviking|${ids.viking}|${OWN_NEAR.x}|${OWN_NEAR.z}|mine|-`,
        `Testviking|${ids.viking}|${DEATH_1.x}|${DEATH_1.z}||${DEATH_1.at}`,
        `Otherviking|${ids.other}|${OTHER.x}|${OTHER.z}||${OTHER.at}`,
      ].sort(),
    );
    expectNoIdentity(res);
  });

  it('server pins: the players filter keeps another SteamID’s death off this character', async () => {
    const res = await get(
      `${BASE}/servers/${server}/pins?worldUid=${WORLD}&players=${ids.viking}`,
    );
    expect(res.status).toBe(200);
    const body = ValheimServerPinsResponseSchema.parse(res.body);
    const reported = body.pins.filter((p) => p.diedAt !== undefined);
    expect(
      reported.map((p) => `${p.characterName}|${p.x}|${p.diedAt ?? '-'}`),
    ).toEqual([`Testviking|${DEATH_1.x}|${DEATH_1.at}`]);
  });
});
