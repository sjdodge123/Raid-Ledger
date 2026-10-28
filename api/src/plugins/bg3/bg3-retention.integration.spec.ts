/**
 * ROK-1957 L8a — `Bg3HistoryRetentionCron` + `releaseUnusedRefsIn` against a
 * real DB (spec §9.2 I-7, D-9 / D-11). Saves and thumbnail refs are inserted
 * directly with their ages set relative to a fixed run time, so every
 * boundary is exact; the cron and repository are the DI-wired providers.
 * No blob files are touched (the job only deletes ref rows; the companion
 * cleanup reaps the bytes later), so no `COMPANION_BLOB_DIR` sandbox.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc } from 'drizzle-orm';
import {
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  Bg3SaveMessageSchema,
  type Bg3SaveMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { makeUser } from '../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { BG3_SESSION_GAP_MS } from './bg3.constants';
import { Bg3HistoryRetentionCron } from './history/bg3-retention.cron';
import { retentionCutoff } from './history/bg3-retention.helpers';
import { Bg3RetentionRepository } from './history/bg3-retention.repository';
import { toBg3SaveRow } from './ingest/bg3-save.handler';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The fixed run time of every `runOnce(NOW)` case. */
const NOW = new Date('2026-10-28T05:15:00Z');
const CUTOFF = retentionCutoff(NOW);
const OLD = NOW.getTime() - 100 * DAY;

const ACT2: Bg3SaveMessage = Bg3SaveMessageSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
      ),
      'utf8',
    ),
  ) as unknown,
);

const sha = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex');
const SHA1 = sha('deleted-only');
const SHA2 = sha('refreshed-during-run');
const SHA_X = sha('used-by-another-campaign');
const SHA3 = sha('on-the-kept-row');

let testApp: TestApp;
const cron = () => testApp.app.get(Bg3HistoryRetentionCron);
const repo = () => testApp.app.get(Bg3RetentionRepository);
const plugins = () => testApp.app.get(PluginRegistryService);

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await plugins().ensureInstalled(BG3_PLUGIN_ID);
  await plugins().activate(BG3_PLUGIN_ID);
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function insertHub(): Promise<number> {
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name: 'Retention Crew',
        nameKey: 'retention crew',
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return hub.id;
}

async function campaign(guildId: number, name: string): Promise<number> {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Campaigns)
      .values({ guildId, name })
      .returning({ id: schema.bg3Campaigns.id }),
    `campaign ${name}`,
  );
  return c.id;
}

/** One save of `userId` at `savedAt` (ms) with an optional thumbnail sha. */
async function seedSave(
  userId: number,
  campaignId: number | null,
  savedAt: number,
  thumb: string | null = null,
): Promise<number> {
  const base = toBg3SaveRow(
    { userId, deviceId: null, receivedAt: new Date(savedAt) },
    ACT2,
    campaignId,
  );
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Saves)
      .values({
        ...base,
        savedAt: new Date(savedAt),
        capturedAt: new Date(savedAt),
        thumbnailSha256: thumb,
      })
      .returning({ id: schema.bg3Saves.id }),
    'save',
  );
  return row.id;
}

async function seedRef(
  userId: number,
  sha256: string,
  referencedAt: Date,
  contract: string = BG3_SAVE_CONTRACT_ID,
): Promise<void> {
  await testApp.db.insert(schema.companionBlobRefs).values({
    userId,
    sha256,
    contract,
    byteLength: 1698,
    width: 1280,
    height: 720,
    referencedAt,
  });
}

/** `[uploader, campaign, savedAt, sessionFirst, sessionCount]`, ordered. */
async function rows() {
  const all = await testApp.db
    .select()
    .from(schema.bg3Saves)
    .orderBy(
      asc(schema.bg3Saves.uploaderUserId),
      asc(schema.bg3Saves.savedAt),
      asc(schema.bg3Saves.id),
    );
  return all.map((r) => [
    r.uploaderUserId,
    r.campaignId,
    r.savedAt.toISOString(),
    r.sessionFirstSavedAt?.toISOString() ?? null,
    r.sessionSaveCount,
  ]);
}

async function refs() {
  const all = await testApp.db.select().from(schema.companionBlobRefs);
  return all.map((r) => [r.userId, r.sha256, r.contract]).sort();
}

const t = (ms: number): string => new Date(ms).toISOString();
const groupKey = (g: { userId: number; campaignId: number | null }) =>
  `${g.userId}/${g.campaignId ?? 'null'}`;

/**
 * u/C: session A (4 rows, OLD+0..3h) + session B (2 rows, OLD+10..11h) +
 * a recent session; u/C2: a recent row still using SHA_X; u/unassigned: an
 * old 2-row session interleaved with A; v/C: two single-row old sessions;
 * w/C3: a session straddling the cutoff (two rows before it, one after).
 */
async function world() {
  const hub = await insertHub();
  const c = await campaign(hub, 'Main');
  const c2 = await campaign(hub, 'Side');
  const c3 = await campaign(hub, 'Straddle');
  const u = (await makeUser(testApp, 'ret-u')).id;
  const v = (await makeUser(testApp, 'ret-v')).id;
  const w = (await makeUser(testApp, 'ret-w')).id;
  await seedSave(u, c, OLD, SHA1);
  await seedSave(u, c, OLD + HOUR, SHA2);
  await seedSave(u, c, OLD + 2 * HOUR, SHA_X);
  await seedSave(u, c, OLD + 3 * HOUR, SHA3);
  await seedSave(u, c, OLD + 10 * HOUR);
  await seedSave(u, c, OLD + 11 * HOUR);
  await seedSave(u, c, NOW.getTime() - DAY);
  await seedSave(u, c, NOW.getTime() - DAY + HOUR);
  await seedSave(u, c2, NOW.getTime() - 2 * DAY, SHA_X);
  await seedSave(u, null, OLD + HOUR / 2);
  await seedSave(u, null, OLD + HOUR + HOUR / 2);
  await seedSave(v, c, OLD - 100 * DAY);
  await seedSave(v, c, OLD);
  await seedSave(w, c3, CUTOFF.getTime() - 2 * HOUR);
  await seedSave(w, c3, CUTOFF.getTime() - HOUR);
  await seedSave(w, c3, CUTOFF.getTime() + HOUR);
  const stale = new Date(OLD);
  await seedRef(u, SHA1, stale);
  await seedRef(u, SHA2, new Date(NOW.getTime() + 60_000));
  await seedRef(u, SHA_X, stale);
  await seedRef(u, SHA3, stale);
  await seedRef(u, SHA1, stale, 'other-contract');
  await seedRef(v, SHA1, stale);
  return { u, v, w, c, c2, c3 };
}

describe('I-7 listGroups (the window query)', () => {
  it('lists only groups with two pre-cutoff rows < 4 h apart; NULL campaign is its own group', async () => {
    const x = await world();
    const groups = await repo().listGroups(CUTOFF, BG3_SESSION_GAP_MS);
    expect(groups.map(groupKey).sort()).toEqual(
      [`${x.u}/${x.c}`, `${x.u}/null`, `${x.w}/${x.c3}`].sort(),
    );
  });
});

describe('I-7 runOnce', () => {
  it('thins each old session to its last row, stamped with first save + count; recent, straddling and single-row sessions untouched', async () => {
    const x = await world();
    expect(await cron().runOnce(NOW)).toBe(5);
    const { u, v, w, c, c2, c3 } = x;
    // rows() order: uploader, then savedAt.
    expect(await rows()).toEqual([
      [u, null, t(OLD + HOUR + HOUR / 2), t(OLD + HOUR / 2), 2],
      [u, c, t(OLD + 3 * HOUR), t(OLD), 4],
      [u, c, t(OLD + 11 * HOUR), t(OLD + 10 * HOUR), 2],
      [u, c2, t(NOW.getTime() - 2 * DAY), null, null],
      [u, c, t(NOW.getTime() - DAY), null, null],
      [u, c, t(NOW.getTime() - DAY + HOUR), null, null],
      [v, c, t(OLD - 100 * DAY), null, null],
      [v, c, t(OLD), null, null],
      [w, c3, t(CUTOFF.getTime() - 2 * HOUR), null, null],
      [w, c3, t(CUTOFF.getTime() - HOUR), null, null],
      [w, c3, t(CUTOFF.getTime() + HOUR), null, null],
    ]);
  });

  it('releases only refs of deleted-only shas; a ref refreshed after the run start, a sha another campaign uses, the kept row, other contracts and other users survive', async () => {
    const x = await world();
    await cron().runOnce(NOW);
    expect(await refs()).toEqual(
      [
        [x.u, SHA2, BG3_SAVE_CONTRACT_ID],
        [x.u, SHA_X, BG3_SAVE_CONTRACT_ID],
        [x.u, SHA3, BG3_SAVE_CONTRACT_ID],
        [x.u, SHA1, 'other-contract'],
        [x.v, SHA1, BG3_SAVE_CONTRACT_ID],
      ].sort(),
    );
  });

  it('a second run changes nothing; only the straddling group stays a candidate', async () => {
    const x = await world();
    await cron().runOnce(NOW);
    const afterRows = await rows();
    const afterRefs = await refs();
    expect(await cron().runOnce(NOW)).toBe(0);
    expect([await rows(), await refs()]).toEqual([afterRows, afterRefs]);
    const groups = await repo().listGroups(CUTOFF, BG3_SESSION_GAP_MS);
    expect(groups.map(groupKey)).toEqual([`${x.w}/${x.c3}`]);
  });
});

describe('I-7 the scheduled entry point', () => {
  it('plugin inactive → prune() does nothing; active → prune() thins', async () => {
    const u = (await makeUser(testApp, 'ret-cron')).id;
    const old = Date.now() - 100 * DAY;
    await seedSave(u, null, old);
    await seedSave(u, null, old + HOUR);
    await plugins().deactivate(BG3_PLUGIN_ID);
    try {
      await cron().prune();
      expect(await rows()).toHaveLength(2);
    } finally {
      await plugins().activate(BG3_PLUGIN_ID);
    }
    await cron().prune();
    expect(await rows()).toEqual([[u, null, t(old + HOUR), t(old), 2]]);
  });
});
