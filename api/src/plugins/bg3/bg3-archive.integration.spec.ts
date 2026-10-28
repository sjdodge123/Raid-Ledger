/**
 * ROK-1958 D-11 — campaign soft archive against a real DB: who may archive,
 * `archivedAt` in the hub list, the active campaign cleared on archive and
 * refused while archived, an archived default ignored by ingest, key
 * bindings still routing rows in, and unarchive restoring the campaign.
 * Conventions follow `bg3-ingest.integration.spec.ts` (no afterAll DB work).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  Bg3CampaignSummarySchema,
  Bg3HubCampaignsResponseSchema,
  Bg3SaveMessageSchema,
  type Bg3CampaignSummary,
  type Bg3HubCampaignsResponse,
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
const KEY_B =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
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

async function insertHub(): Promise<number> {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: "Baldur's Gate 3", slug: BG3_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'bg3 game',
  );
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: game.id,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name: 'BG3 Crew',
        nameKey: 'bg3 crew',
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

/** Host (creator), a plain member and a hub editor; the host's campaign is active. */
async function world() {
  const hubId = await insertHub();
  const host = await makeUser(testApp, 'bg3-host');
  const mate = await makeUser(testApp, 'bg3-mate');
  const editor = await makeUser(testApp, 'bg3-officer');
  await joinHub(hubId, host.id);
  await joinHub(hubId, mate.id);
  await joinHub(hubId, editor.id, 'officer');
  const campaignId = await createCampaign(host.token, hubId, 'Act Two');
  return { hubId, host, mate, editor, campaignId };
}

function patch(token: string, campaignId: number, body: object) {
  return testApp.request
    .patch(`${BG3}/campaigns/${campaignId}`)
    .set(bearer(token))
    .send(body);
}

async function archive(token: string, campaignId: number, archived = true) {
  const res = await patch(token, campaignId, { archived });
  expect(res.status).toBe(200);
  return Bg3CampaignSummarySchema.parse(res.body);
}

async function hubCampaigns(
  token: string,
  hubId: number,
): Promise<Bg3HubCampaignsResponse> {
  const res = await testApp.request
    .get(`${BG3}/hubs/${hubId}/campaigns`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return Bg3HubCampaignsResponseSchema.parse(res.body);
}

function byId(list: Bg3CampaignSummary[], id: number): Bg3CampaignSummary {
  const found = list.find((c) => c.id === id);
  if (!found) throw new Error(`campaign ${id} missing from the hub list`);
  return found;
}

async function put(token: string, path: string, body: object) {
  return testApp.request.put(`${BG3}${path}`).set(bearer(token)).send(body);
}

async function placement(): Promise<[string, number | null][]> {
  const rows = await testApp.db
    .select()
    .from(schema.bg3Saves)
    .orderBy(asc(schema.bg3Saves.id));
  return rows.map((r) => [r.campaignKey, r.campaignId]);
}

describe('D-11 who may archive', () => {
  it('403s a plain member and leaves the campaign live', async () => {
    const w = await world();
    const res = await patch(w.mate.token, w.campaignId, { archived: true });
    expect(res.status).toBe(403);
    const list = await hubCampaigns(w.host.token, w.hubId);
    expect(byId(list.campaigns, w.campaignId).archivedAt).toBeNull();
  });

  it('lets the host archive and unarchive; archivedAt set then cleared in the list', async () => {
    const w = await world();
    const archived = await archive(w.host.token, w.campaignId);
    expect(archived.archivedAt).not.toBeNull();
    let list = await hubCampaigns(w.mate.token, w.hubId);
    expect(byId(list.campaigns, w.campaignId).archivedAt).toBe(
      archived.archivedAt,
    );

    const restored = await archive(w.host.token, w.campaignId, false);
    expect(restored.archivedAt).toBeNull();
    list = await hubCampaigns(w.mate.token, w.hubId);
    expect(byId(list.campaigns, w.campaignId).archivedAt).toBeNull();
  });

  it('lets a hub editor who is not the host archive', async () => {
    const w = await world();
    const res = await archive(w.editor.token, w.campaignId);
    expect(res.archivedAt).not.toBeNull();
  });
});

describe('D-11 the active campaign', () => {
  it('archiving the active campaign clears activeCampaignId', async () => {
    const w = await world();
    const before = await hubCampaigns(w.host.token, w.hubId);
    expect(before.settings.activeCampaignId).toBe(w.campaignId);

    const res = await archive(w.host.token, w.campaignId);
    expect(res.isActive).toBe(false);
    const after = await hubCampaigns(w.host.token, w.hubId);
    expect(after.settings.activeCampaignId).toBeNull();
  });

  it('archiving another campaign leaves the active one alone', async () => {
    const w = await world();
    const other = await createCampaign(w.host.token, w.hubId, 'Side Run');
    await archive(w.host.token, other);
    const list = await hubCampaigns(w.host.token, w.hubId);
    expect(list.settings.activeCampaignId).toBe(w.campaignId);
  });

  it('400s an archived campaign as the active one; unarchived it is accepted', async () => {
    const w = await world();
    await archive(w.host.token, w.campaignId);
    const path = `/hubs/${w.hubId}/settings`;
    const refused = await put(w.editor.token, path, {
      activeCampaignId: w.campaignId,
    });
    expect([refused.status, refused.body.message]).toEqual([
      400,
      'campaign_archived',
    ]);

    await archive(w.host.token, w.campaignId, false);
    const ok = await put(w.editor.token, path, {
      activeCampaignId: w.campaignId,
    });
    expect(ok.status).toBe(200);
  });
});

describe('D-11 defaults and bindings', () => {
  it('an archived default is ignored for a new save and reported as no default', async () => {
    const w = await world();
    const def = await put(w.host.token, '/me/default-campaign', {
      campaignId: w.campaignId,
    });
    expect(def.status).toBe(204);
    await archive(w.host.token, w.campaignId);

    await ingest(w.host.token, save(KEY_B, '2026-10-24T20:00:00Z'));
    expect(await placement()).toEqual([[KEY_B, null]]);
    const mine = await testApp.request
      .get(`${BG3}/me/saves`)
      .set(bearer(w.host.token));
    expect(mine.body.defaultCampaignId).toBeNull();
  });

  it('400s setting an archived campaign as the default', async () => {
    const w = await world();
    await archive(w.host.token, w.campaignId);
    const res = await put(w.mate.token, '/me/default-campaign', {
      campaignId: w.campaignId,
    });
    expect([res.status, res.body.message]).toEqual([400, 'campaign_archived']);
  });

  it('a key binding still routes new saves into an archived campaign', async () => {
    const w = await world();
    const bound = await put(w.host.token, `/me/campaign-keys/${KEY_A}`, {
      campaignId: w.campaignId,
    });
    expect(bound.status).toBe(204);
    await archive(w.host.token, w.campaignId);

    await ingest(w.host.token, save(KEY_A, '2026-10-24T21:00:00Z'));
    expect(await placement()).toEqual([[KEY_A, w.campaignId]]);
    const [row] = await testApp.db
      .select({ archivedAt: schema.bg3Campaigns.archivedAt })
      .from(schema.bg3Campaigns)
      .where(eq(schema.bg3Campaigns.id, w.campaignId));
    expect(row?.archivedAt).not.toBeNull();
  });
});
