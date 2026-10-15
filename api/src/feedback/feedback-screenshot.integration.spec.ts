/**
 * ROK-1313: POST /feedback screenshot + clientContext persistence, against a
 * real DB and a sandboxed screenshot dir (RAID_LEDGER_FEEDBACK_DIR).
 *
 * Proves: bytes land at `<dir>/<id>.<ext>` with `screenshot_path`
 * `feedback/<id>.<ext>`; a 400/413 writes no row and no file; the 8 MB route
 * parser beats the global 2 MB one; account delete and ban + wipe remove
 * the files.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { eq, sql } from 'drizzle-orm';
import { FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';

const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG_B64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
]).toString('base64');
const TEXT_B64 = Buffer.from('definitely not an image').toString('base64');
const MESSAGE = 'The raid roster page breaks when I scroll down';

const ORIGINAL_DIR = process.env.RAID_LEDGER_FEEDBACK_DIR;

let testApp: TestApp;
let adminToken: string;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rl-feedback-'));
  process.env.RAID_LEDGER_FEEDBACK_DIR = dir;
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  // Ids restart after a truncate; clear the dir so files never leak across tests.
  for (const f of await readdir(dir)) await rm(path.join(dir, f));
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  if (ORIGINAL_DIR === undefined) delete process.env.RAID_LEDGER_FEEDBACK_DIR;
  else process.env.RAID_LEDGER_FEEDBACK_DIR = ORIGINAL_DIR;
});

function post(body: Record<string, unknown>, token = adminToken) {
  return testApp.request
    .post('/feedback')
    .set('Authorization', `Bearer ${token}`)
    .send({ category: 'bug', message: MESSAGE, ...body });
}

async function rowById(id: number) {
  const rows = await testApp.db
    .select()
    .from(schema.feedback)
    .where(eq(schema.feedback.id, id));
  return nonEmpty(rows, `feedback row ${id}`)[0];
}

async function expectNothingWritten(): Promise<void> {
  expect(await testApp.db.select().from(schema.feedback)).toEqual([]);
  expect(await readdir(dir)).toEqual([]);
}

describe('POST /feedback — screenshot stored', () => {
  it('writes a PNG to <dir>/<id>.png and records feedback/<id>.png', async () => {
    const res = await post({ screenshotBase64: PNG_1X1_B64 });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    const row = await rowById(id);
    expect(row.screenshotPath).toBe(`feedback/${id}.png`);
    const onDisk = await readFile(path.join(dir, `${id}.png`));
    expect(onDisk.equals(Buffer.from(PNG_1X1_B64, 'base64'))).toBe(true);
  });

  it('stores a JPEG with a .jpg extension', async () => {
    const res = await post({ screenshotBase64: JPEG_B64 });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    expect((await rowById(id)).screenshotPath).toBe(`feedback/${id}.jpg`);
    expect(await readdir(dir)).toEqual([`${id}.jpg`]);
  });

  it('accepts a ~3 MB screenshot (route parser is 8 MB, global is 2 MB)', async () => {
    const big = Buffer.alloc(2_400_000);
    Buffer.from(PNG_1X1_B64, 'base64').copy(big);
    const b64 = big.toString('base64');
    expect(b64.length).toBeGreaterThan(3_000_000);
    const res = await post({ screenshotBase64: b64 });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    expect((await readFile(path.join(dir, `${id}.png`))).length).toBe(
      big.length,
    );
  });

  it('leaves screenshot_path null when no screenshot is sent', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect((await rowById(res.body.id as number)).screenshotPath).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('POST /feedback — screenshot rejected', () => {
  it('returns 413 over the base64 cap and writes nothing', async () => {
    const tooBig = 'A'.repeat(FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS + 4);
    const res = await post({ screenshotBase64: tooBig });
    expect(res.status).toBe(413);
    await expectNothingWritten();
  });

  it('returns 400 for non-image bytes and writes nothing', async () => {
    const res = await post({ screenshotBase64: TEXT_B64 });
    expect(res.status).toBe(400);
    await expectNothingWritten();
  });

  it('returns 400 for non-image bytes behind a data:image/png header', async () => {
    const res = await post({
      screenshotBase64: `data:image/png;base64,${TEXT_B64}`,
    });
    expect(res.status).toBe(400);
    await expectNothingWritten();
  });
});

describe('POST /feedback — clientContext', () => {
  it('round-trips clientContext into client_context', async () => {
    const clientContext = {
      viewport: { w: 1280, h: 800 },
      userAgent: 'Mozilla/5.0 (integration)',
      appVersion: '1.2.3',
    };
    const res = await post({ clientContext });
    expect(res.status).toBe(201);
    expect((await rowById(res.body.id as number)).clientContext).toEqual(
      clientContext,
    );
  });

  it('stores null when clientContext is omitted', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect((await rowById(res.body.id as number)).clientContext).toBeNull();
  });
});

describe('account delete → feedback screenshot cleanup', () => {
  it("removes the deleted user's screenshot files and keeps others'", async () => {
    const member = await createMemberAndLogin(
      testApp,
      'fb-shot-member',
      'fb-shot-member@example.test',
    );
    const mine = await post({ screenshotBase64: PNG_1X1_B64 }, member.token);
    const theirs = await post({ screenshotBase64: JPEG_B64 });
    expect([mine.status, theirs.status]).toEqual([201, 201]);
    expect(await readdir(dir)).toHaveLength(2);
    const del = await testApp.request
      .delete(`/users/${member.userId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    expect(await readdir(dir)).toEqual([`${theirs.body.id as number}.jpg`]);
  });
});

/** Poll until some query in this database is waiting on a row lock. */
async function untilAQueryWaitsOnALock(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const rows = await testApp.db.execute(
      sql`select 1 from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`,
    );
    if (rows.length > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the account delete never waited on the screenshot update');
}

describe('account delete racing an in-flight screenshot store', () => {
  it('removes a screenshot whose path commits while the delete is in flight', async () => {
    const member = await createMemberAndLogin(
      testApp,
      'fb-shot-race',
      'fb-shot-race@example.test',
    );
    const res = await post({}, member.token);
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    // storeScreenshot mid-flight: file written, path update not yet committed.
    await writeFile(
      path.join(dir, `${id}.png`),
      Buffer.from(PNG_1X1_B64, 'base64'),
    );
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const store = testApp.db.transaction(async (tx) => {
      await tx
        .update(schema.feedback)
        .set({ screenshotPath: `feedback/${id}.png` })
        .where(eq(schema.feedback.id, id));
      await gate;
    });
    const del = testApp.request
      .delete(`/users/${member.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .then((r) => r.status);
    await untilAQueryWaitsOnALock();
    release();
    await store;
    expect(await del).toBe(204);
    expect({ leftOnDisk: await readdir(dir) }).toEqual({ leftOnDisk: [] });
  });
});

describe('ban with wipeData → feedback screenshot cleanup', () => {
  it("removes the banned user's screenshot files and keeps others'", async () => {
    const member = await createMemberAndLogin(
      testApp,
      'fb-shot-banned',
      'fb-shot-banned@example.test',
    );
    const mine = await post({ screenshotBase64: PNG_1X1_B64 }, member.token);
    const theirs = await post({ screenshotBase64: JPEG_B64 });
    expect([mine.status, theirs.status]).toEqual([201, 201]);
    await testApp.request
      .post(`/users/${member.userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'abuse', wipeData: true })
      .expect(201);
    expect(await readdir(dir)).toEqual([`${theirs.body.id as number}.jpg`]);
  });
});
