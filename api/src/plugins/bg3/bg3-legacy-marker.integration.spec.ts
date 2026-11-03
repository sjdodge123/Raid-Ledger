/**
 * ROK-2070 Codex P2 — a latest-wins marker written before B1 (keyed by the
 * bare `campaignKey`) still refuses a replay of its save after retention has
 * pruned the row, so the retained session summary is not double-counted. A
 * genuinely newer save is accepted, and "Delete my BG3 data" clears it.
 * No afterAll DB work: the shared setup closes the pool.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  Bg3SaveMessageSchema,
  type Bg3SaveMessage,
} from '@raid-ledger/contract';
import type { Response } from 'supertest';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  makeUser,
} from '../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

const MESSAGES = `/companion/v1/messages/${BG3_SAVE_CONTRACT_ID}`;
const FIXTURE = join(
  __dirname,
  '../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
);
const ACT2: Bg3SaveMessage = Bg3SaveMessageSchema.parse(
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown,
);
const KEY = ACT2.payload.campaignKey;
const T = '2026-10-24T10:00:00.000Z';
const T_PLUS_1 = '2026-10-24T10:00:01.000Z';

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

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** The act2 fixture as a folder-key save at `savedAt`. */
function folderSave(savedAt: string): Bg3SaveMessage {
  return {
    ...ACT2,
    capturedAt: '2026-10-25T00:00:00Z',
    payload: {
      ...ACT2.payload,
      campaignKey: KEY,
      campaignKeySource: 'save-folder',
      savedAt,
    },
  };
}

function ingest(token: string, msg: Bg3SaveMessage) {
  return testApp.request
    .post(MESSAGES)
    .set('Content-Type', 'application/json')
    .set(bearer(token))
    .serialize((bytes) => bytes)
    .send(Buffer.from(JSON.stringify(msg)));
}

function expectAck(res: Response, status: 'accepted' | 'stale'): void {
  expect([res.status, res.body]).toEqual([202, { status }]);
}

/** A pre-B1 marker: the bare campaign key at `T`, with no surviving row. */
async function legacyUser(tag: string) {
  const user = await makeUser(testApp, tag);
  await testApp.db.insert(schema.companionIngestLatest).values({
    userId: user.id,
    contract: BG3_SAVE_CONTRACT_ID,
    latestKey: KEY,
    latestAt: new Date(T),
  });
  return user;
}

async function savedAts(): Promise<string[]> {
  const rows = await testApp.db.select().from(schema.bg3Saves);
  return rows.map((r) => r.savedAt.toISOString());
}

describe('a pre-B1 bare-key marker keeps replay protection (ROK-2070 Codex P2)', () => {
  it('a replay at the marker time with its row pruned → stale, no row', async () => {
    const u = await legacyUser('legacy-replay');
    expectAck(await ingest(u.token, folderSave(T)), 'stale');
    expect(await savedAts()).toEqual([]);
  });

  it('a newer save under the same folder key → accepted and stored', async () => {
    const u = await legacyUser('legacy-newer');
    expectAck(await ingest(u.token, folderSave(T_PLUS_1)), 'accepted');
    expect(await savedAts()).toEqual([T_PLUS_1]);
  });

  it('after "Delete my BG3 data" the replay is accepted', async () => {
    const u = await legacyUser('legacy-deleted');
    const del = await testApp.request
      .delete('/plugins/bg3/me/data')
      .set(bearer(u.token));
    expect(del.status).toBe(200);
    expectAck(await ingest(u.token, folderSave(T)), 'accepted');
    expect(await savedAts()).toEqual([T]);
  });
});
