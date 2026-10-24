/**
 * ROK-1946 lane B — `GET plugins/valheim/armory/servers/:serverId/portals`
 * against a real database. D7 audience: every signed-in viewer of a visible
 * hub (member AND non-member) → 200; signed-out → 401; hidden hub, no hub,
 * unknown server → the hub 404. D6 shape: rows ordered x, z; an absent
 * `worldUid` serves the server's NEWEST scan, even when it is empty.
 */
import { eq } from 'drizzle-orm';
import {
  ValheimServerPortalsResponseSchema,
  type ValheimServerPortalsResponse,
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
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';

const W1 = '1234567890123';
const W2 = '9876543210987';
let testApp: TestApp;
let gameId: number;
let server: number;
let hubId: number;
let tokens: Record<'member' | 'visitor' | 'operator', string>;

type P = {
  prefab: string;
  x: number;
  y: number | null;
  z: number;
  tag: string;
};
const url = (s: number, w?: string) =>
  `/plugins/valheim/armory/servers/${s}/portals${w ? `?worldUid=${w}` : ''}`;
const get = (s: number, t: string | null, w?: string) => {
  const req = testApp.request.get(url(s, w));
  return t ? req.set({ Authorization: `Bearer ${t}` }) : req;
};

async function makeServer(n: number): Promise<number> {
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

/** One stored scan (header + rows), as the lane-A importer leaves it. */
async function scan(s: number, worldUid: string, hour: number, portals: P[]) {
  const [h] = nonEmpty(
    await testApp.db
      .insert(schema.valheimPortalScans)
      .values({
        pelicanServerId: s,
        worldUid,
        gameVersion: '0.220.5',
        capturedAt: new Date(Date.UTC(2026, 9, 20, hour)),
        omitted: 0,
        portalCount: portals.length,
      })
      .returning({ id: schema.valheimPortalScans.id }),
    'scan',
  );
  if (portals.length) {
    await testApp.db
      .insert(schema.valheimPortals)
      .values(portals.map((p) => ({ ...p, scanId: h.id, pelicanServerId: s })));
  }
}

const portal = (x: number, z: number, tag: string): P => ({
  prefab: 'portal_wood',
  x,
  y: null,
  z,
  tag,
});

async function portalsOf(
  t: string,
  w?: string,
): Promise<ValheimServerPortalsResponse> {
  const res = await get(server, t, w);
  expect({ status: res.status, cache: res.headers['cache-control'] }).toEqual({
    status: 200,
    cache: 'private, max-age=60',
  });
  return ValheimServerPortalsResponseSchema.parse(res.body);
}
const tags = (r: ValheimServerPortalsResponse) => r.portals.map((p) => p.tag);

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
  gameId = g.id;
  server = await makeServer(1);
  hubId = await ensureFixtureHubId(testApp.db, server, gameId);
  tokens = {
    member: await makeMember('member'),
    visitor: (await makeUser('visitor')).token,
    operator: (await makeUser('operator', 'operator')).token,
  };
});

describe('GET …/servers/:serverId/portals — audience (D7)', () => {
  it('serves a hub member AND a signed-in non-member the same portals', async () => {
    await scan(server, W1, 1, [portal(5, 1, 'home')]);
    expect(tags(await portalsOf(tokens.member))).toEqual(['home']);
    expect(tags(await portalsOf(tokens.visitor))).toEqual(['home']);
  });

  it('answers a signed-out request with 401', async () => {
    expect((await get(server, null)).status).toBe(401);
  });

  it('hides a hidden hub from a non-staff member (404) but not from staff', async () => {
    await scan(server, W1, 1, [portal(5, 1, 'home')]);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));
    const hidden = await get(server, tokens.member);
    expect({ status: hidden.status, message: hidden.body.message }).toEqual({
      status: 404,
      message: HUB_NOT_FOUND,
    });
    expect(tags(await portalsOf(tokens.operator))).toEqual(['home']);
  });

  it('answers an unknown server and a hub-less server with the hub 404, staff too', async () => {
    const bare = await makeServer(2);
    const res = await Promise.all([
      get(server + 999, tokens.operator),
      get(bare, tokens.operator),
    ]);
    expect(res.map((r) => [r.status, r.body.message])).toEqual([
      [404, HUB_NOT_FOUND],
      [404, HUB_NOT_FOUND],
    ]);
  });
});

describe('GET …/servers/:serverId/portals — body (D6)', () => {
  it('orders portals x then z, as the repository does', async () => {
    await scan(server, W1, 1, [
      portal(9, 0, 'c'),
      portal(-3, 7, 'b'),
      portal(-3, -2, 'a'),
    ]);
    const body = await portalsOf(tokens.member, W1);
    expect({ worldUid: body.worldUid, scannedAt: body.scannedAt }).toEqual({
      worldUid: W1,
      scannedAt: '2026-10-20T01:00:00.000Z',
    });
    expect(body.portals.map((p) => `${p.x},${p.z},${p.tag}`)).toEqual([
      '-3,-2,a',
      '-3,7,b',
      '9,0,c',
    ]);
  });

  it('no worldUid → the newest scan; an empty newest scan is [] not the older rows', async () => {
    await scan(server, W1, 1, [portal(1, 1, 'old-world')]);
    await scan(server, W2, 5, []);
    expect(await portalsOf(tokens.member)).toEqual({
      worldUid: W2,
      scannedAt: '2026-10-20T05:00:00.000Z',
      omitted: 0,
      portals: [],
    });
    expect(tags(await portalsOf(tokens.member, W1))).toEqual(['old-world']);
  });

  it('no scan at all → 200 with scannedAt null; unknown world echoes the world', async () => {
    expect(await portalsOf(tokens.visitor)).toEqual({
      worldUid: null,
      scannedAt: null,
      omitted: 0,
      portals: [],
    });
    expect((await portalsOf(tokens.visitor, W2)).worldUid).toBe(W2);
  });

  it('rejects a malformed worldUid with 400 Invalid worldUid', async () => {
    const res = await get(server, tokens.member, 'abc');
    expect({ status: res.status, message: res.body.message }).toEqual({
      status: 400,
      message: 'Invalid worldUid',
    });
  });
});
