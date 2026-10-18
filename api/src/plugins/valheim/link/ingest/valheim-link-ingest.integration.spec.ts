/**
 * ROK-1833 — Valheim Link message ingest against a real database: golden
 * fixtures 202, latest-wins, invalid fixtures 400 with the expected issue,
 * server mismatch 403, a gzip bomb 413, gzip-encoded bodies, unknown kind 404.
 */
import { and, eq } from 'drizzle-orm';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  VALHEIM_LINK_CHARACTER_MAX_BYTES,
  ValheimLinkIngestResultSchema,
  ValheimLinkTokenIssuedSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { hashValheimLinkToken } from '../valheim-link-token.helpers';
import { ValheimLinkIngestService } from './valheim-link-ingest.service';
import {
  VALHEIM_LINK_FIXTURES,
  loadValheimFixture,
  rejection,
  valheimFixtureNames,
} from './valheim-link-ingest.testing';

const ROUTE = '/plugins/valheim/link/messages';
const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const INVALID = join(VALHEIM_LINK_FIXTURES, 'invalid');
const KINDS = ['character', 'map', 'items'];

let testApp: TestApp;
let adminToken: string;
const registry = () => testApp.app.get(PluginRegistryService);

async function valheimServer(n: number): Promise<number> {
  const [game] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, VALHEIM_GAME_SLUG));
  const gameId =
    game?.id ??
    nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
        .returning({ id: schema.games.id }),
      'valheim game',
    )[0].id;
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
    `pelican server ${n}`,
  );
  return row.id;
}

async function issueToken(serverId: number): Promise<string> {
  const res = await testApp.request
    .post(`/admin/plugins/valheim/link-tokens/${serverId}`)
    .set({ Authorization: `Bearer ${adminToken}` })
    .send({});
  return ValheimLinkTokenIssuedSchema.parse(res.body).token;
}

/** A fixture re-pointed at `serverId`, captured at `capturedAt`. */
function message(
  name: string,
  serverId: number,
  capturedAt: string,
  dir?: string,
): Record<string, unknown> {
  return {
    ...loadValheimFixture(name, dir),
    serverId: String(serverId),
    capturedAt,
  };
}

/**
 * superagent JSON-serialises any non-string body sent as `application/json` —
 * a Buffer would arrive as `{"type":"Buffer","data":[…]}`. The identity
 * serializer puts the bytes on the wire as-is (gzip bodies included).
 */
function post(kind: string, token: string, body: Buffer, gzip = false) {
  const r = testApp.request
    .post(`${ROUTE}/${kind}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .serialize((bytes) => bytes);
  return (gzip ? r.set('Content-Encoding', 'gzip') : r).send(body);
}

const json = (o: unknown): Buffer => Buffer.from(JSON.stringify(o));
const recent = (minutesAgo: number): string =>
  new Date(Date.now() - minutesAgo * 60_000)
    .toISOString()
    .replace(/\.\d+Z$/, 'Z');

async function snapshots(serverId: number) {
  return testApp.db
    .select()
    .from(schema.valheimLinkSnapshots)
    .where(eq(schema.valheimLinkSnapshots.pelicanServerId, serverId));
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('Valheim Link message ingest (ROK-1833)', () => {
  it.each(valheimFixtureNames(VALHEIM_LINK_FIXTURES))(
    '202 accepted: %s',
    async (name) => {
      const id = await valheimServer(1);
      const token = await issueToken(id);
      const msg = message(name, id, recent(10));
      const res = await post(String(msg['kind']), token, json(msg));
      expect(res.status).toBe(202);
      expect(ValheimLinkIngestResultSchema.parse(res.body).status).toBe(
        'accepted',
      );
      const rows = await snapshots(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: msg['kind'], status: 'pending' });
    },
  );

  it('latest wins: an older message is stale and leaves the row; a newer one replaces it', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const newer = message('character-vanilla', id, recent(5));
    expect((await post('character', token, json(newer))).status).toBe(202);
    const older = message('character-vanilla', id, recent(30));
    const stale = await post('character', token, json(older));
    expect(stale.status).toBe(202);
    expect(stale.body).toEqual({ status: 'stale', missingBlobs: [] });
    const [row] = await snapshots(id);
    expect(row?.capturedAt.toISOString()).toBe(
      new Date(String(newer.capturedAt)).toISOString(),
    );
    const newest = message('character-vanilla', id, recent(1));
    expect((await post('character', token, json(newest))).body.status).toBe(
      'accepted',
    );
    const after = await snapshots(id);
    expect(after).toHaveLength(1);
    expect(after[0]?.capturedAt.toISOString()).toBe(
      new Date(String(newest.capturedAt)).toISOString(),
    );
  });

  it('ingests a gzip-encoded fixture', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const msg = message('map-shared-layer', id, recent(2));
    const res = await post('map', token, gzipSync(json(msg)), true);
    expect(res.status).toBe(202);
    expect(await snapshots(id)).toHaveLength(1);
  });

  it.each(valheimFixtureNames(INVALID))(
    '400 schema_invalid: invalid/%s',
    async (name) => {
      const expected = loadValheimFixture('EXPECTED', INVALID)[name];
      const id = await valheimServer(1);
      const token = await issueToken(id);
      // Keep the fixture's own capturedAt — it IS the defect in one fixture.
      const msg: Record<string, unknown> = {
        ...loadValheimFixture(name, INVALID),
        serverId: String(id),
      };
      const kind = KINDS.includes(String(msg['kind']))
        ? String(msg['kind'])
        : 'character';
      const res = await post(kind, token, json(msg));
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'schema_invalid' });
      expect(res.body.issues).toEqual(expect.arrayContaining([expected]));
      expect(await snapshots(id)).toHaveLength(0);
    },
  );

  it('403 server_mismatch for another server’s serverId; nothing written for either', async () => {
    const a = await valheimServer(1);
    const b = await valheimServer(2);
    const token = await issueToken(a);
    const res = await post(
      'character',
      token,
      json(message('character-vanilla', b, recent(2))),
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'server_mismatch' });
    expect([...(await snapshots(a)), ...(await snapshots(b))]).toHaveLength(0);
  });

  it('413 on a gzip body that inflates past the character cap', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const bomb = gzipSync(
      Buffer.alloc(VALHEIM_LINK_CHARACTER_MAX_BYTES + 1, 0x20),
    );
    const res = await post('character', token, bomb, true);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'payload_too_large' });
  });

  it('400 captured_at_in_future past server time + 5 min; 404 unknown kind', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const future = message('character-vanilla', id, recent(-6));
    const skew = await post('character', token, json(future));
    expect(skew.body).toMatchObject({ code: 'captured_at_in_future' });
    expect(skew.status).toBe(400);
    const unknown = await post('weather', token, json(future));
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'unknown_kind' });
    const rows = await testApp.db
      .select()
      .from(schema.valheimLinkSnapshots)
      .where(and(eq(schema.valheimLinkSnapshots.pelicanServerId, id)));
    expect(rows).toHaveLength(0);
  });
});

describe('Valheim Link ingest — token revalidated at commit (ROK-1833)', () => {
  /** The auth record the guard would have attached for `token`. */
  async function authFor(serverId: number, token: string) {
    const [row] = nonEmpty(
      await testApp.db
        .select({ id: schema.valheimLinkTokens.id })
        .from(schema.valheimLinkTokens)
        .where(eq(schema.valheimLinkTokens.pelicanServerId, serverId)),
      'token row',
    );
    return {
      tokenId: row.id,
      tokenHash: hashValheimLinkToken(token),
      pelicanServerId: serverId,
      serverId: String(serverId),
    };
  }

  it.each([
    ['revoked', { revokedAt: new Date() }],
    ['rotated', { tokenHash: 'f'.repeat(64) }],
  ])(
    'a token %s after auth is 401 invalid_token and writes nothing',
    async (_l, change) => {
      const id = await valheimServer(1);
      const token = await issueToken(id);
      const valheimLink = await authFor(id, token);
      await testApp.db
        .update(schema.valheimLinkTokens)
        .set(change)
        .where(eq(schema.valheimLinkTokens.id, valheimLink.tokenId));
      const body = json(message('character-vanilla', id, recent(5)));
      const r = await rejection(
        testApp.app
          .get(ValheimLinkIngestService)
          .ingest({ headers: {}, valheimLink }, 'character', body),
      );
      expect(r).toEqual({
        status: 401,
        body: expect.objectContaining({ code: 'invalid_token' }),
      });
      expect(await snapshots(id)).toHaveLength(0);
    },
  );
});

describe('Valheim Link snapshot quota (ROK-1833)', () => {
  afterEach(() => {
    delete process.env.VALHEIM_LINK_MAX_SNAPSHOTS_PER_SERVER;
  });

  it('a NEW key past the cap is 413 quota_exceeded; an update of a stored key still lands', async () => {
    process.env.VALHEIM_LINK_MAX_SNAPSHOTS_PER_SERVER = '1';
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const first = message('character-vanilla', id, recent(10));
    expect((await post('character', token, json(first))).status).toBe(202);
    const other = message('map-shared-layer', id, recent(9));
    const over = await post(String(other['kind']), token, json(other));
    expect(over.status).toBe(413);
    expect(over.body).toMatchObject({ code: 'quota_exceeded' });
    const newer = message('character-vanilla', id, recent(1));
    const upd = await post('character', token, json(newer));
    expect(upd.status).toBe(202);
    expect(ValheimLinkIngestResultSchema.parse(upd.body).status).toBe(
      'accepted',
    );
    expect(await snapshots(id)).toHaveLength(1);
  });
});
