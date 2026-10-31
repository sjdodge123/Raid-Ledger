/**
 * ROK-1960 F3 — `GET /plugins/bg3/me/campaign-keys/:key` against a real DB:
 * where the caller's OWN saves with a key sit (binding, else the latest
 * assigned save), counted for the caller only, and redacted to null campaign
 * + hub once the caller can no longer read that hub. Conventions follow
 * `bg3-archive.integration.spec.ts` (no afterAll DB work).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  Bg3CampaignKeyBindingResponseSchema,
  Bg3CampaignSummarySchema,
  Bg3SaveMessageSchema,
  type Bg3SaveMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  makeUser,
} from '../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

const MESSAGES = `/companion/v1/messages/${BG3_SAVE_CONTRACT_ID}`;
const BG3 = '/plugins/bg3';
const FIXTURE = join(
  __dirname,
  '../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
);
const ACT2: Bg3SaveMessage = Bg3SaveMessageSchema.parse(
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown,
);
const KEY_A = ACT2.payload.campaignKey;
const CAPTURED = '2026-10-25T00:00:00Z';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(BG3_PLUGIN_ID);
  await plugins.activate(BG3_PLUGIN_ID);
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function save(key: string, savedAt: string): Bg3SaveMessage {
  return {
    ...ACT2,
    capturedAt: CAPTURED,
    payload: { ...ACT2.payload, savedAt, campaignKey: key },
  };
}

async function ingest(token: string, msg: Bg3SaveMessage): Promise<void> {
  const res = await testApp.request
    .post(MESSAGES)
    .set('Content-Type', 'application/json')
    .set(bearer(token))
    .serialize((bytes) => bytes)
    .send(Buffer.from(JSON.stringify(msg)));
  expect([res.status, res.body]).toEqual([202, { status: 'accepted' }]);
}

async function bg3GameId(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, BG3_GAME_SLUG));
  if (found) return found.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: "Baldur's Gate 3", slug: BG3_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'bg3 game',
  );
  return game.id;
}

async function insertHub(name = 'BG3 Crew'): Promise<number> {
  const gameId = await bg3GameId();
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return hub.id;
}

async function joinHub(
  guildId: number,
  userId: number,
  role: 'member' | 'officer' = 'member',
): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role });
}

async function createCampaign(token: string, hubId: number, name: string) {
  const res = await testApp.request
    .post(`${BG3}/hubs/${hubId}/campaigns`)
    .set(bearer(token))
    .send({ name });
  expect(res.status).toBe(201);
  return Bg3CampaignSummarySchema.parse(res.body).id;
}

async function put(token: string, path: string, body: object) {
  return testApp.request.put(`${BG3}${path}`).set(bearer(token)).send(body);
}

async function binding(token: string, key: string = KEY_A) {
  const res = await testApp.request
    .get(`${BG3}/me/campaign-keys/${key}`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return Bg3CampaignKeyBindingResponseSchema.parse(res.body).binding;
}

/** Host + mate in one hub; the host's campaign "Act Two". */
async function world() {
  const hubId = await insertHub();
  const host = await makeUser(testApp, 'bg3-host');
  const mate = await makeUser(testApp, 'bg3-mate');
  await joinHub(hubId, host.id);
  await joinHub(hubId, mate.id);
  const campaignId = await createCampaign(host.token, hubId, 'Act Two');
  return { hubId, host, mate, campaignId };
}

describe('GET /plugins/bg3/me/campaign-keys/:key', () => {
  it('is null for a key the caller never bound nor filed', async () => {
    const w = await world();
    expect(await binding(w.host.token)).toBeNull();
  });

  it("names the bound campaign + hub and counts only the caller's own saves", async () => {
    const w = await world();
    const bound = await put(w.host.token, `/me/campaign-keys/${KEY_A}`, {
      campaignId: w.campaignId,
    });
    expect(bound.status).toBe(204);
    await ingest(w.host.token, save(KEY_A, '2026-10-24T20:00:00Z'));
    await ingest(w.host.token, save(KEY_A, '2026-10-24T21:00:00Z'));
    await ingest(w.mate.token, save(KEY_A, '2026-10-24T22:00:00Z'));
    expect(await binding(w.host.token)).toEqual({
      campaignId: w.campaignId,
      campaignName: 'Act Two',
      hubId: w.hubId,
      hubName: 'BG3 Crew',
      saveCount: 2,
    });
    // The mate's same-key save is unassigned (no binding, no default): nothing to report.
    expect(await binding(w.mate.token)).toBeNull();
  });

  it('without a binding, reports the campaign the default filed the saves into', async () => {
    const w = await world();
    const def = await put(w.host.token, '/me/default-campaign', {
      campaignId: w.campaignId,
    });
    expect(def.status).toBe(204);
    await ingest(w.host.token, save(KEY_A, '2026-10-24T20:00:00Z'));
    expect(await binding(w.host.token)).toMatchObject({
      campaignId: w.campaignId,
      hubId: w.hubId,
      saveCount: 1,
    });
  });
});

describe('GET /plugins/bg3/me/campaign-keys/:key — redaction + validation', () => {
  it('redacts campaign + hub once the caller has left that hub (count kept)', async () => {
    const w = await world();
    await put(w.host.token, `/me/campaign-keys/${KEY_A}`, {
      campaignId: w.campaignId,
    });
    await ingest(w.host.token, save(KEY_A, '2026-10-24T20:00:00Z'));
    await testApp.db
      .delete(schema.hubCommunityMembers)
      .where(
        and(
          eq(schema.hubCommunityMembers.guildId, w.hubId),
          eq(schema.hubCommunityMembers.userId, w.host.id),
        ),
      );
    expect(await binding(w.host.token)).toEqual({
      campaignId: null,
      campaignName: null,
      hubId: null,
      hubName: null,
      saveCount: 1,
    });
  });

  it('400s a malformed key', async () => {
    const w = await world();
    const res = await testApp.request
      .get(`${BG3}/me/campaign-keys/not-a-key`)
      .set(bearer(w.host.token));
    expect(res.status).toBe(400);
  });
});
