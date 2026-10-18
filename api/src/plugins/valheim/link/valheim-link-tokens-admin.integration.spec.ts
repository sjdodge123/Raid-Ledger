/**
 * ROK-1833 — Valheim Link token admin endpoints against a real database:
 * list / status / issue (409 without rotate) / rotate / revoke, the guards,
 * no hash or token in any non-issue response, and auto-revoke when the
 * Pelican PATCH re-maps the row away from Valheim.
 */
import { eq } from 'drizzle-orm';
import {
  ValheimLinkTokenIssuedSchema,
  ValheimLinkTokenListResponseSchema,
  ValheimLinkTokenStatusSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { memberToken } from '../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { hashValheimLinkToken } from './valheim-link-token.helpers';

const ROUTE = '/admin/plugins/valheim/link-tokens';
const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });

async function valheimGameId(): Promise<number> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, VALHEIM_GAME_SLUG));
  if (existing) return existing.id;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'valheim game',
  );
  return row.id;
}

async function insertServer(n: number, gameId: number | null): Promise<number> {
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

async function tokenRow(serverId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.valheimLinkTokens)
    .where(eq(schema.valheimLinkTokens.pelicanServerId, serverId));
  return row;
}

const issue = (id: number, body: object = {}, token = adminToken) =>
  testApp.request.post(`${ROUTE}/${id}`).set(auth(token)).send(body);

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

describe('Valheim Link token admin (ROK-1833)', () => {
  it('issues once, stores only the hash + hint, and never echoes either afterwards', async () => {
    const id = await insertServer(1, await valheimGameId());
    const res = await issue(id);
    expect(res.status).toBe(201);
    const issued = ValheimLinkTokenIssuedSchema.parse(res.body);
    const row = nonEmpty(
      [await tokenRow(id)].filter((r) => r !== undefined),
      'token row',
    )[0];
    expect(row.tokenHash).toBe(hashValheimLinkToken(issued.token));
    expect(row.tokenHint).toBe(issued.token.slice(-4));

    const status = await testApp.request.get(`${ROUTE}/${id}`).set(auth());
    const list = await testApp.request.get(ROUTE).set(auth());
    expect(ValheimLinkTokenStatusSchema.parse(status.body).state).toBe(
      'active',
    );
    expect(
      ValheimLinkTokenListResponseSchema.parse(list.body).data,
    ).toHaveLength(1);
    for (const text of [status.text, list.text]) {
      expect(text).not.toContain(issued.token);
      expect(text).not.toContain(row.tokenHash);
    }
  });

  it('409 on a second issue without rotate; rotate replaces the hash at once', async () => {
    const id = await insertServer(1, await valheimGameId());
    const first = ValheimLinkTokenIssuedSchema.parse((await issue(id)).body);
    expect((await issue(id)).status).toBe(409);
    const viaFlag = await issue(id, { rotate: true });
    expect(viaFlag.status).toBe(201);
    const rotated = await testApp.request
      .post(`${ROUTE}/${id}/rotate`)
      .set(auth());
    expect(rotated.status).toBe(201);
    const latest = ValheimLinkTokenIssuedSchema.parse(rotated.body);
    const row = await tokenRow(id);
    expect(row?.tokenHash).toBe(hashValheimLinkToken(latest.token));
    expect(row?.tokenHash).not.toBe(hashValheimLinkToken(first.token));
    expect(row?.rotatedAt).not.toBeNull();
  });

  it('revoke → revoked; second revoke 404; re-issue is live again', async () => {
    const id = await insertServer(1, await valheimGameId());
    await issue(id);
    const revoked = await testApp.request.delete(`${ROUTE}/${id}`).set(auth());
    expect(revoked.status).toBe(200);
    expect(ValheimLinkTokenStatusSchema.parse(revoked.body).state).toBe(
      'revoked',
    );
    expect(
      (await testApp.request.delete(`${ROUTE}/${id}`).set(auth())).status,
    ).toBe(404);
    expect((await issue(id)).status).toBe(201);
    expect((await tokenRow(id))?.revokedAt).toBeNull();
  });
});

describe('Valheim Link token admin — errors, guards, re-map (ROK-1833)', () => {
  it('404 unknown server, 400 for a row not mapped to Valheim, 400 bad body', async () => {
    const other = await insertServer(2, testApp.seed.game.id);
    expect((await issue(987_654)).status).toBe(404);
    expect((await issue(other)).status).toBe(400);
    const id = await insertServer(1, await valheimGameId());
    expect((await issue(id, { rotate: 'yes' })).status).toBe(400);
  });

  it('non-admin 403; inactive Valheim plugin 403', async () => {
    const id = await insertServer(1, await valheimGameId());
    const member = await memberToken(testApp, 'vl-member');
    expect((await issue(id, {}, member)).status).toBe(403);
    await registry().deactivate(VALHEIM_PLUGIN_ID);
    expect((await issue(id)).status).toBe(403);
    expect(await tokenRow(id)).toBeUndefined();
  });

  it('re-mapping the row away from Valheim revokes its live token; staying on Valheim does not', async () => {
    const valheim = await valheimGameId();
    const id = await insertServer(1, valheim);
    await issue(id);
    const patch = (body: object) =>
      testApp.request
        .patch(`/admin/plugins/pelican/servers/${id}`)
        .set(auth())
        .send(body);
    expect((await patch({ gameId: valheim })).status).toBe(200);
    expect((await tokenRow(id))?.revokedAt).toBeNull();
    expect((await patch({ gameId: testApp.seed.game.id })).status).toBe(200);
    expect((await tokenRow(id))?.revokedAt).not.toBeNull();
  });
});
