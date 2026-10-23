/**
 * ROK-1933 L6a — POST /admin/test/valheim/claim-drive-fixture and
 * POST /admin/test/valheim/claim-suggest-scan (integration, real DB). The
 * fixture gives each worker its own server hub with one character claimed by
 * a fresh user A and two unclaimed (one named like fresh user B); the scan
 * trigger runs one claim-suggest scan. Both 403 without DEMO_MODE.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { ValheimClaimStatusResponseSchema } from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { findUnclaimedSightings } from './identity/valheim-claim-suggest.queries';
import type { ClaimSuggestScanResult } from './identity/valheim-claim-suggest-demo.controller';
import type {
  ClaimDriveFixture,
  ClaimDriveUser,
} from './valheim-claim-drive-demo-seed.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/claim-drive-fixture';
const SCAN = '/admin/test/valheim/claim-suggest-scan';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

async function seed(body: object = {}): Promise<ClaimDriveFixture> {
  const res = await testApp.request
    .post(ROUTE)
    .set(bearer(adminToken))
    .send(body);
  expect(res.status).toBe(200);
  return res.body as ClaimDriveFixture;
}

/** A member session for a seeded (Discord-only, passwordless) user. */
function tokenFor(user: ClaimDriveUser): Promise<string> {
  return signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: 'member',
  });
}

async function claimStatus(serverId: number, user: ClaimDriveUser) {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/servers/${serverId}/claim-status`)
    .set(bearer(await tokenFor(user)));
  expect(res.status).toBe(200);
  return ValheimClaimStatusResponseSchema.parse(res.body);
}

async function profilesOn(serverId: number) {
  const P = schema.valheimProfiles;
  return testApp.db
    .select({ id: P.id, name: P.name, claimedBy: P.claimedBy })
    .from(P)
    .where(eq(P.pelicanServerId, serverId))
    .orderBy(P.id);
}

beforeAll(async () => {
  process.env.VALHEIM_LINK_BLOB_DIR = await mkdtemp(
    join(tmpdir(), 'vh-claim-drive-'),
  );
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await setDemoMode(true);
  await testApp.db
    .insert(schema.games)
    .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG });
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
});

afterAll(() => {
  delete process.env.VALHEIM_LINK_BLOB_DIR;
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/valheim/claim-drive-fixture (ROK-1933 L6a)', () => {
  it('seeds A claimed, two unclaimed (one named like B), B with no claim', async () => {
    const f = await seed({ worker: 3 });
    expect(f.eventId).toBeNull();
    expect(f.characters.matching.name).toBe(f.users.b.displayName);
    expect(await profilesOn(f.serverId)).toEqual([
      {
        id: f.characters.claimed.id,
        name: f.characters.claimed.name,
        claimedBy: f.users.a.id,
      },
      {
        id: f.characters.matching.id,
        name: f.users.b.displayName,
        claimedBy: null,
      },
      {
        id: f.characters.other.id,
        name: f.characters.other.name,
        claimedBy: null,
      },
    ]);
    const G = schema.guilds;
    const [hub] = await testApp.db.select().from(G).where(eq(G.id, f.guildId));
    expect(hub).toMatchObject({
      kind: 'game_server',
      pelicanServerId: f.serverId,
      hiddenAt: null,
    });
    expect(await claimStatus(f.serverId, f.users.b)).toEqual({
      viewerHasClaim: false,
      unclaimedCount: 2,
    });
    expect(await claimStatus(f.serverId, f.users.a)).toEqual({
      viewerHasClaim: true,
      unclaimedCount: 2,
    });
  });

  it('re-seeding a worker resets its characters on the same hub with fresh users', async () => {
    const first = await seed({ worker: 1 });
    const second = await seed({ worker: 1 });
    expect(second.serverId).toBe(first.serverId);
    expect(second.guildId).toBe(first.guildId);
    expect(second.users.b.id).not.toBe(first.users.b.id);
    expect((await profilesOn(second.serverId)).map((p) => p.id)).toEqual([
      second.characters.claimed.id,
      second.characters.matching.id,
      second.characters.other.id,
    ]);
    const other = await seed({ worker: 2 });
    expect(other.serverId).not.toBe(first.serverId);
  });

  it('nameSuffix is appended to the server and hub name; omitted, the default stays', async () => {
    const hubName = async (f: ClaimDriveFixture): Promise<[string, string]> => {
      const [server] = await testApp.db
        .select({ name: schema.pelicanServers.name })
        .from(schema.pelicanServers)
        .where(eq(schema.pelicanServers.id, f.serverId));
      const [hub] = await testApp.db
        .select({ name: schema.guilds.name })
        .from(schema.guilds)
        .where(eq(schema.guilds.id, f.guildId));
      return [server?.name ?? 'no server', hub?.name ?? 'no hub'];
    };
    const plain = await seed({ worker: 4 });
    expect(await hubName(plain)).toEqual(['Claimheim 4', 'Claimheim 4']);
    const run1 = await seed({ worker: 4, nameSuffix: 'run-1' });
    expect(run1.guildId).toBe(plain.guildId);
    expect(await hubName(run1)).toEqual([
      'Claimheim 4 run-1',
      'Claimheim 4 run-1',
    ]);
    const run2 = await seed({ worker: 4, nameSuffix: 'Ab9' });
    expect(await hubName(run2)).toEqual(['Claimheim 4 Ab9', 'Claimheim 4 Ab9']);
    await seed({ worker: 4 });
    expect(await hubName(plain)).toEqual(['Claimheim 4', 'Claimheim 4']);
  });

  it('sighting:true leaves a sighting that a scan past the minimum age sees', async () => {
    const f = await seed({ sighting: true });
    expect(f.eventId).toEqual(expect.any(Number));
    const later = new Date(Date.now() + 11 * 60_000);
    const sightings = await findUnclaimedSightings(testApp.db, later);
    expect(sightings.map((s) => [s.profileId, s.guildId])).toEqual([
      [f.characters.matching.id, f.guildId],
    ]);
    const again = await seed({ sighting: true });
    const E = schema.events;
    const live = await testApp.db
      .select({ id: E.id })
      .from(E)
      .where(eq(E.isAdHoc, true));
    expect(live).toEqual([{ id: again.eventId }]);
  });

  it('400s on a bad body; 409s on a taken bDiscordId', async () => {
    for (const body of [
      { worker: 99 },
      { sighting: 'yes' },
      { bDiscordId: 'abc' },
      { nameSuffix: '' },
      { nameSuffix: 'has space' },
      { nameSuffix: 'a'.repeat(13) },
      { nameSuffix: 7 },
      { extra: 1 },
    ]) {
      const res = await testApp.request
        .post(ROUTE)
        .set(bearer(adminToken))
        .send(body);
      expect(res.status).toBe(400);
    }
    const f = await seed();
    const U = schema.users;
    const [b] = await testApp.db
      .select({ discordId: U.discordId })
      .from(U)
      .where(eq(U.id, f.users.b.id));
    const res = await testApp.request
      .post(ROUTE)
      .set(bearer(adminToken))
      .send({ bDiscordId: b?.discordId ?? 'missing' });
    expect(res.status).toBe(409);
  });

  it('403s both routes without DEMO_MODE', async () => {
    await setDemoMode(false);
    for (const path of [ROUTE, SCAN]) {
      const res = await testApp.request
        .post(path)
        .set(bearer(adminToken))
        .send({});
      expect(res.status).toBe(403);
    }
  });
});

describe('POST /admin/test/valheim/claim-suggest-scan (ROK-1933 L6a)', () => {
  it('runs one scan with a clock past the minimum age', async () => {
    const before = Date.now();
    const res = await testApp.request
      .post(SCAN)
      .set(bearer(adminToken))
      .send({});
    expect(res.status).toBe(200);
    const body = res.body as ClaimSuggestScanResult;
    expect(body.queued).toBe(0);
    expect(Date.parse(body.now)).toBeGreaterThanOrEqual(before + 11 * 60_000);
  });
});
