/**
 * ROK-1957 L8a — `bg3-save` ingest → save history → hub reads against a real
 * DB (spec §9.2 I-1…I-6, plus I-9's "ingest with the plugin inactive"). The
 * production `Bg3SaveHandler` is registered by `Bg3Module`; nothing here
 * stubs it. Hubs are inserted directly (a `game_community` hub of the
 * `BG3_GAME_SLUG` game); campaigns, bindings and defaults go through the
 * routes. No blob bytes are uploaded — ingest only records the thumbnail ref.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import type { Response } from 'supertest';
import {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  Bg3CampaignSummarySchema,
  Bg3MySavesResponseSchema,
  Bg3SaveMessageSchema,
  Bg3SessionsResponseSchema,
  Bg3SnapshotResponseSchema,
  CompanionIngestAckSchema,
  type Bg3MySavesResponse,
  type Bg3SaveMessage,
  type Bg3SessionsResponse,
  type Bg3Snapshot,
  type Bg3SnapshotResponse,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
} from '../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { Bg3SaveHandler } from './ingest/bg3-save.handler';

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
const KEY_C =
  'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
/** Every capturedAt: after each savedAt below, never in the future. */
const CAPTURED = '2026-10-25T00:00:00Z';
const at = (hh: string): string => `2026-10-24T${hh}:00:00Z`;
const iso = (t: string): string => new Date(t).toISOString();

let testApp: TestApp;
const plugins = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  await plugins().ensureInstalled(BG3_PLUGIN_ID);
  await plugins().activate(BG3_PLUGIN_ID);
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** The act2 fixture at another key / time (capturedAt always CAPTURED). */
function save(over: { savedAt?: string; key?: string } = {}): Bg3SaveMessage {
  return {
    ...ACT2,
    capturedAt: CAPTURED,
    payload: {
      ...ACT2.payload,
      savedAt: over.savedAt ?? ACT2.payload.savedAt,
      campaignKey: over.key ?? KEY_A,
    },
  };
}

/** POST one message with a session JWT or a device token. */
function ingest(token: string, msg: Bg3SaveMessage = save()) {
  return (
    testApp.request
      .post(MESSAGES)
      .set('Content-Type', 'application/json')
      .set(bearer(token))
      // superagent would JSON-serialise a Buffer itself; send the bytes as-is.
      .serialize((bytes) => bytes)
      .send(Buffer.from(JSON.stringify(msg)))
  );
}

function expectAck(res: Response, status: 'accepted' | 'stale'): void {
  expect([res.status, res.body]).toEqual([202, { status }]);
  expect(CompanionIngestAckSchema.safeParse(res.body).success).toBe(true);
}

/** The BG3 game row (inserted once per case; truncate wipes it). */
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

async function insertHub(name: string): Promise<number> {
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: await bg3GameId(),
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    `hub ${name}`,
  );
  return hub.id;
}

async function joinHub(guildId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role: 'member' });
}

async function createCampaign(
  token: string,
  hubId: number,
  name: string,
): Promise<number> {
  const res = await testApp.request
    .post(`${BG3}/hubs/${hubId}/campaigns`)
    .set(bearer(token))
    .send({ name });
  expect(res.status).toBe(201);
  return Bg3CampaignSummarySchema.parse(res.body).id;
}

/** A BG3 hub, its host + a second member, and one campaign the host made. */
async function world() {
  const hubId = await insertHub('BG3 Crew');
  const host = await makeUser(testApp, 'bg3-host');
  const mate = await makeUser(testApp, 'bg3-mate');
  await joinHub(hubId, host.id);
  await joinHub(hubId, mate.id);
  const campaignId = await createCampaign(host.token, hubId, 'Act Two');
  return { hubId, host, mate, campaignId };
}

async function bind(token: string, key: string, campaignId: number) {
  const res = await testApp.request
    .put(`${BG3}/me/campaign-keys/${key}`)
    .set(bearer(token))
    .send({ campaignId });
  expect(res.status).toBe(204);
}

async function setDefault(token: string, campaignId: number) {
  const res = await testApp.request
    .put(`${BG3}/me/default-campaign`)
    .set(bearer(token))
    .send({ campaignId });
  expect(res.status).toBe(204);
}

async function snapshot(
  token: string,
  hubId: number,
  campaignId: number,
): Promise<Bg3SnapshotResponse> {
  const res = await testApp.request
    .get(`${BG3}/hubs/${hubId}/snapshot?campaignId=${campaignId}`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return Bg3SnapshotResponseSchema.parse(res.body);
}

/** The non-empty snapshot (fails loudly on `{ empty: true }`). */
function filled(r: Bg3SnapshotResponse): Bg3Snapshot {
  if (r.empty) throw new Error(`snapshot of ${r.campaignId} is empty`);
  return r;
}

async function sessions(
  token: string,
  hubId: number,
  campaignId: number,
): Promise<Bg3SessionsResponse> {
  const res = await testApp.request
    .get(`${BG3}/hubs/${hubId}/campaigns/${campaignId}/sessions`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return Bg3SessionsResponseSchema.parse(res.body);
}

async function mySaves(
  token: string,
  unassigned = false,
): Promise<Bg3MySavesResponse> {
  const res = await testApp.request
    .get(`${BG3}/me/saves${unassigned ? '?unassigned=true' : ''}`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return Bg3MySavesResponseSchema.parse(res.body);
}

function saveRows() {
  return testApp.db
    .select()
    .from(schema.bg3Saves)
    .orderBy(asc(schema.bg3Saves.id));
}

/** `[campaignKey, campaignId]` of every save, in insert order. */
async function placement(): Promise<[string, number | null][]> {
  return (await saveRows()).map((r) => [r.campaignKey, r.campaignId]);
}

describe('I-1 ingest → history + snapshot', () => {
  it('a device posts act2-party-4p-summon → 202, one row in the bound campaign, snapshot has 5 slots (summon null)', async () => {
    const w = await world();
    const device = await linkDevice(testApp, w.host.token);
    await bind(w.host.token, KEY_A, w.campaignId);
    expectAck(await ingest(device.token, ACT2), 'accepted');

    const rows = await saveRows();
    expect(
      rows.map((r) => ({
        uploader: r.uploaderUserId,
        device: r.deviceId,
        campaign: r.campaignId,
        key: r.campaignKey,
        savedAt: r.savedAt.toISOString(),
        partyMaxLevel: r.partyMaxLevel,
        thumb: r.thumbnailSha256,
      })),
    ).toEqual([
      {
        uploader: w.host.id,
        device: device.deviceId,
        campaign: w.campaignId,
        key: KEY_A,
        savedAt: iso(ACT2.payload.savedAt),
        partyMaxLevel: 8,
        thumb: ACT2.payload.thumbnail?.sha256 ?? null,
      },
    ]);

    const snap = filled(await snapshot(w.mate.token, w.hubId, w.campaignId));
    const [row] = nonEmpty(rows, 'save row');
    expect({
      saveId: snap.saveId,
      uploader: snap.uploaderUserId,
      area: snap.area,
      slots: snap.party.map((p) => p.slotKey),
    }).toEqual({
      saveId: row.id,
      uploader: w.host.id,
      area: ACT2.payload.currentLevel,
      slots: [
        'Generic:Elf_WoodElf:1',
        null,
        'Generic:Human:1',
        'Generic:Duergar:1',
        'Generic:Tiefling_Asmodeus:1',
      ],
    });
  });

  it('the thumbnail ref is recorded for the uploader under bg3-save', async () => {
    const w = await world();
    expectAck(await ingest(w.host.token), 'accepted');
    const refs = await testApp.db.select().from(schema.companionBlobRefs);
    expect(refs.map((r) => [r.userId, r.sha256, r.contract])).toEqual([
      [w.host.id, ACT2.payload.thumbnail?.sha256, BG3_SAVE_CONTRACT_ID],
    ]);
  });
});

describe('I-2 unassigned → bind', () => {
  it('no binding, no default → campaign_id NULL, absent from the snapshot, present in me/saves; PUT the binding assigns it', async () => {
    const w = await world();
    expectAck(await ingest(w.host.token), 'accepted');
    const [row] = nonEmpty(await saveRows(), 'save row');
    expect(row.campaignId).toBeNull();
    expect(await snapshot(w.host.token, w.hubId, w.campaignId)).toEqual({
      empty: true,
      campaignId: w.campaignId,
    });
    const mine = await mySaves(w.host.token, true);
    expect(mine.saves.map((s) => [s.id, s.campaignId])).toEqual([
      [row.id, null],
    ]);

    await bind(w.host.token, KEY_A, w.campaignId);
    expect(await placement()).toEqual([[KEY_A, w.campaignId]]);
    const snap = filled(await snapshot(w.host.token, w.hubId, w.campaignId));
    expect(snap.saveId).toBe(row.id);
    expect((await mySaves(w.host.token, true)).saves).toEqual([]);
  });

  it('a binding to a hub the uploader has left → the new save stays unassigned', async () => {
    const w = await world();
    await bind(w.mate.token, KEY_A, w.campaignId);
    await testApp.db
      .update(schema.hubCommunityMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(schema.hubCommunityMembers.guildId, w.hubId),
          eq(schema.hubCommunityMembers.userId, w.mate.id),
        ),
      );
    expectAck(await ingest(w.mate.token), 'accepted');
    expect(await placement()).toEqual([[KEY_A, null]]);
  });
});

/**
 * Review fix 1: the hub-membership read runs on the ingest tx. Proof: the
 * uploader re-joins INSIDE the tx (uncommitted) — only a read on that same
 * tx sees it. A read on a second pool connection sees "left" (and, at
 * DB_POOL_MAX=1, waits forever on the connection the tx holds).
 */
describe('I-2b membership is read on the ingest tx', () => {
  it('an uncommitted re-join inside the ingest tx assigns the save to the bound campaign', async () => {
    const w = await world();
    await bind(w.mate.token, KEY_A, w.campaignId);
    const mateRow = and(
      eq(schema.hubCommunityMembers.guildId, w.hubId),
      eq(schema.hubCommunityMembers.userId, w.mate.id),
    );
    await testApp.db
      .update(schema.hubCommunityMembers)
      .set({ leftAt: new Date() })
      .where(mateRow);
    const handler = testApp.app.get(Bg3SaveHandler);
    await testApp.db.transaction(async (tx) => {
      await tx
        .update(schema.hubCommunityMembers)
        .set({ leftAt: null })
        .where(mateRow);
      await handler.handle(
        {
          tx,
          userId: w.mate.id,
          via: 'session',
          deviceId: null,
          receivedAt: new Date(),
        },
        save(),
      );
    });
    expect(await placement()).toEqual([[KEY_A, w.campaignId]]);
  });
});

describe('I-3 default campaign', () => {
  it('setting a default assigns existing unassigned rows; new unbound saves land in it; a binding still wins', async () => {
    const w = await world();
    const other = await createCampaign(w.host.token, w.hubId, 'Other Run');
    await bind(w.host.token, KEY_B, other);
    expectAck(await ingest(w.host.token, save({ key: KEY_A })), 'accepted');
    expect(await placement()).toEqual([[KEY_A, null]]);

    await setDefault(w.host.token, w.campaignId);
    expect(await placement()).toEqual([[KEY_A, w.campaignId]]);
    expect((await mySaves(w.host.token)).defaultCampaignId).toBe(w.campaignId);

    expectAck(await ingest(w.host.token, save({ key: KEY_C })), 'accepted');
    expectAck(await ingest(w.host.token, save({ key: KEY_B })), 'accepted');
    expect(await placement()).toEqual([
      [KEY_A, w.campaignId],
      [KEY_C, w.campaignId],
      [KEY_B, other],
    ]);
  });
});

describe('I-4 dedupe', () => {
  it('a replay of the same message → stale, still one row', async () => {
    const w = await world();
    await bind(w.host.token, KEY_A, w.campaignId);
    expectAck(await ingest(w.host.token), 'accepted');
    expectAck(await ingest(w.host.token), 'stale');
    expect(await saveRows()).toHaveLength(1);
  });

  it("host and non-host rows with the same key and time → the snapshot shows the host's (the non-host row is older)", async () => {
    const w = await world();
    await bind(w.mate.token, KEY_A, w.campaignId);
    await bind(w.host.token, KEY_A, w.campaignId);
    expectAck(await ingest(w.mate.token), 'accepted');
    expectAck(await ingest(w.host.token), 'accepted');
    const rows = await saveRows();
    expect(rows.map((r) => r.uploaderUserId)).toEqual([w.mate.id, w.host.id]);
    const hostRow = nonEmpty(
      rows.filter((r) => r.uploaderUserId === w.host.id),
      'host row',
    )[0];
    const snap = filled(await snapshot(w.mate.token, w.hubId, w.campaignId));
    expect([snap.uploaderUserId, snap.saveId]).toEqual([w.host.id, hostRow.id]);
    // The duplicate is one save in the history, not two.
    const s = await sessions(w.mate.token, w.hubId, w.campaignId);
    expect(s.sessions.map((x) => [x.saveCount, x.lastSaveId])).toEqual([
      [1, hostRow.id],
    ]);
  });
});

describe('I-5 several keys per campaign', () => {
  it('two keys bound to one campaign → both feed its sessions and snapshot', async () => {
    const w = await world();
    await bind(w.host.token, KEY_A, w.campaignId);
    await bind(w.host.token, KEY_B, w.campaignId);
    const a = save({ key: KEY_A, savedAt: at('10') });
    const b = save({ key: KEY_B, savedAt: at('11') });
    expectAck(await ingest(w.host.token, a), 'accepted');
    expectAck(await ingest(w.host.token, b), 'accepted');
    const [, rowB] = await saveRows();
    if (!rowB) throw new Error('KEY_B row missing');
    const s = await sessions(w.host.token, w.hubId, w.campaignId);
    expect(
      s.sessions.map((x) => [
        iso(x.startedAt),
        iso(x.endedAt),
        x.saveCount,
        x.lastSaveId,
      ]),
    ).toEqual([[iso(at('10')), iso(at('11')), 2, rowB.id]]);
    const snap = filled(await snapshot(w.host.token, w.hubId, w.campaignId));
    expect(snap.saveId).toBe(rowB.id);
  });
});

describe('I-6 clustering', () => {
  it('saves across a 5 h gap → 2 sessions, newest first', async () => {
    const w = await world();
    await bind(w.host.token, KEY_A, w.campaignId);
    for (const hh of ['10', '11', '16']) {
      expectAck(
        await ingest(w.host.token, save({ savedAt: at(hh) })),
        'accepted',
      );
    }
    const s = await sessions(w.host.token, w.hubId, w.campaignId);
    expect(
      s.sessions.map((x) => [iso(x.startedAt), iso(x.endedAt), x.saveCount]),
    ).toEqual([
      [iso(at('16')), iso(at('16')), 1],
      [iso(at('10')), iso(at('11')), 2],
    ]);
  });
});

describe('I-9 ingest with the plugin inactive', () => {
  it('→ 404 unknown_contract and nothing written', async () => {
    const w = await world();
    await bind(w.host.token, KEY_A, w.campaignId);
    await plugins().deactivate(BG3_PLUGIN_ID);
    try {
      const res = await ingest(w.host.token);
      expect([res.status, (res.body as { code?: unknown }).code]).toEqual([
        404,
        'unknown_contract',
      ]);
      expect(await saveRows()).toEqual([]);
    } finally {
      await plugins().activate(BG3_PLUGIN_ID);
    }
  });
});
