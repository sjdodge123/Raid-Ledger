/**
 * ROK-1956 L6 — `PUT /companion/v1/blobs/:sha256` + the orphan cleanup
 * against a real DB and a real filesystem (spec §10 I-14…I-21). The store
 * root is a per-file tmpdir (`COMPANION_BLOB_DIR`); every WebP is generated
 * in-test with sharp (never a real screenshot). A bg3-save handler that
 * declares the payload thumbnail as its blob ref is registered here (D-4: no
 * production handler exists), owned by an active plugin.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Response } from 'supertest';
import {
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  Bg3SaveMessageSchema,
  COMPANION_WEBP_MAX_BYTES,
  CompanionBlobAckSchema,
  CompanionIngestErrorSchema,
  type Bg3SaveMessage,
  type CompanionWebpRef,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { shadowBg3SaveHandler } from '../ingest/testing/shadow-bg3-save-handler';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
  withEnv,
} from '../devices/testing/companion-link.helpers';
import {
  type CompanionContractHandler,
  type CompanionHandlerContext,
} from '../ingest/companion-handler.registry';
import { CompanionBlobCleanupService } from './companion-blob-cleanup.service';
import { CompanionBlobsRepository } from './companion-blobs.repository';

const BLOBS = '/companion/v1/blobs';
const MESSAGES = '/companion/v1/messages';
/** The real `bg3-save` v1 owner; its handler is shadowed by `handler`. */
const OWNER = BG3_PLUGIN_ID;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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

let testApp: TestApp;
let restoreHandler: (() => void) | undefined;
let root = '';
const priorDir = process.env.COMPANION_BLOB_DIR;

const handle = jest.fn<
  Promise<void>,
  [CompanionHandlerContext, Bg3SaveMessage]
>();
const handler: CompanionContractHandler<Bg3SaveMessage> = {
  contract: BG3_SAVE_CONTRACT_ID,
  versions: [1],
  latestWins: (m) => ({
    key: m.payload.campaignKey,
    at: new Date(m.payload.savedAt),
  }),
  blobRefs: (m) => (m.payload.thumbnail ? [m.payload.thumbnail] : []),
  handle: (ctx, m) => handle(ctx, m),
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'rl-companion-blobs-'));
  process.env.COMPANION_BLOB_DIR = root;
  testApp = await getTestApp();
  restoreHandler = shadowBg3SaveHandler(testApp.app, handler);
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  handle.mockReset();
  handle.mockResolvedValue(undefined);
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(OWNER);
  await plugins.activate(OWNER);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  // User ids can repeat after a truncate: start every case with an empty root.
  for (const name of readdirSync(root)) {
    rmSync(join(root, name), { recursive: true, force: true });
  }
});

afterAll(() => {
  restoreHandler?.();
  if (priorDir === undefined) delete process.env.COMPANION_BLOB_DIR;
  else process.env.COMPANION_BLOB_DIR = priorDir;
  rmSync(root, { recursive: true, force: true });
});

/** A tiny still WebP (lossless keeps the bytes deterministic per input). */
function webp(width: number, height: number, red = 10): Promise<Buffer> {
  const create = {
    width,
    height,
    channels: 3,
    background: { r: red, g: 20, b: 30 },
  } as const;
  return sharp({ create }).webp({ lossless: true }).toBuffer();
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** The ref a message would carry for `bytes` (dims overridable). */
function refOf(
  bytes: Buffer,
  width: number,
  height: number,
  over: Partial<CompanionWebpRef> = {},
): CompanionWebpRef {
  return {
    sha256: sha(bytes),
    byteLength: bytes.length,
    contentType: 'image/webp',
    width,
    height,
    ...over,
  };
}

interface PutOpts {
  token?: string;
  contentType?: string;
  encoding?: string;
}

function put(path: string, body: Buffer, opts: PutOpts = {}) {
  let r = testApp.request
    .put(`${BLOBS}/${path}`)
    .set('Content-Type', opts.contentType ?? 'image/webp');
  if (opts.token !== undefined) r = r.set(bearer(opts.token));
  if (opts.encoding !== undefined) r = r.set('Content-Encoding', opts.encoding);
  // superagent would JSON-serialise a Buffer itself under application/json
  // (`{"type":"Buffer","data":[…]}`); send the bytes as-is.
  return r.serialize((bytes) => bytes).send(body);
}

const putBlob = (token: string, bytes: Buffer) =>
  put(sha(bytes), bytes, { token });

/** POST a bg3 message whose payload thumbnail is `thumbnail`. */
function postWithThumbnail(token: string, thumbnail: CompanionWebpRef | null) {
  const msg: Bg3SaveMessage = {
    ...ACT2,
    payload: { ...ACT2.payload, thumbnail },
  };
  return (
    testApp.request
      .post(`${MESSAGES}/${BG3_SAVE_CONTRACT_ID}`)
      .set('Content-Type', 'application/json')
      .set(bearer(token))
      // superagent would JSON-serialise the Buffer itself; send the bytes as-is.
      .serialize((bytes) => bytes)
      .send(Buffer.from(JSON.stringify(msg)))
  );
}

function expectAck(res: Response, status: 'stored' | 'exists', hash: string) {
  expect([res.status, res.body]).toEqual([
    status === 'stored' ? 201 : 200,
    { status, sha256: hash },
  ]);
  expect(CompanionBlobAckSchema.safeParse(res.body).success).toBe(true);
}

/** The §9 error answer: status + code, a wire-valid body, connection closed. */
function expectError(res: Response, status: number, code: string): void {
  const body = res.body as { code?: unknown };
  expect([res.status, body.code]).toEqual([status, code]);
  expect(CompanionIngestErrorSchema.safeParse(res.body).success).toBe(true);
  expect(res.headers['connection']).toBe('close');
}

async function member(name: string) {
  const user = await makeUser(testApp, name);
  const device = await linkDevice(testApp, user.token);
  return { id: user.id, session: user.token, ...device };
}

const blobFile = (userId: number, hash: string): string =>
  join(root, String(userId), `${hash}.webp`);

/** Every entry in the user's folder (temps included), sorted. */
function entries(userId: number): string[] {
  const dir = join(root, String(userId));
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

async function blobRows() {
  const rows = await testApp.db.select().from(schema.companionBlobs);
  return rows.map((r) => [r.userId, r.sha256]).sort();
}

async function refRows() {
  const rows = await testApp.db.select().from(schema.companionBlobRefs);
  return rows
    .map((r) => [
      r.userId,
      r.sha256,
      r.contract,
      r.byteLength,
      r.width,
      r.height,
    ])
    .sort();
}

describe('I-14 a valid upload', () => {
  it('201 stored: file at <dir>/<userId>/<sha>.webp with the exact bytes, row present, no temp left', async () => {
    const m = await member('cb-happy');
    const bytes = await webp(16, 8);
    const hash = sha(bytes);
    expectAck(await putBlob(m.token, bytes), 'stored', hash);
    expect(readFileSync(blobFile(m.id, hash)).equals(bytes)).toBe(true);
    expect(entries(m.id)).toEqual([`${hash}.webp`]);
    const [row] = nonEmpty(
      await testApp.db.select().from(schema.companionBlobs),
      'blob row',
    );
    expect(row).toMatchObject({
      userId: m.id,
      sha256: hash,
      byteLength: bytes.length,
      width: 16,
      height: 8,
      contentType: 'image/webp',
      storagePath: `${m.id}/${hash}.webp`,
      deviceId: m.deviceId,
    });
  });

  it('re-PUT → 200 exists + Connection: close before the body is checked; still one row', async () => {
    const m = await member('cb-again');
    const bytes = await webp(16, 8);
    const hash = sha(bytes);
    expectAck(await putBlob(m.token, bytes), 'stored', hash);
    const again = await putBlob(m.token, bytes);
    expectAck(again, 'exists', hash);
    expect(again.headers['connection']).toBe('close');
    // Step 2 runs before the media/header checks: garbage is never read.
    const garbage = await put(hash, Buffer.from('nope'), {
      token: m.token,
      contentType: 'text/plain',
    });
    expectAck(garbage, 'exists', hash);
    expect(await blobRows()).toEqual([[m.id, hash]]);
    expect(entries(m.id)).toEqual([`${hash}.webp`]);
  });
});

describe('I-15 bad bodies and media types', () => {
  it('PNG bytes sent as image/webp → 400 invalid_blob; no row, no file, no temp', async () => {
    const m = await member('cb-png');
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    expectError(await putBlob(m.token, png), 400, 'invalid_blob');
    expect(await blobRows()).toEqual([]);
    expect(entries(m.id)).toEqual([]);
  });

  it('a RIFF size that disagrees with the length (one trailing byte) → 400 invalid_blob at EOF', async () => {
    const m = await member('cb-riff');
    const bytes = Buffer.concat([await webp(16, 8), Buffer.from([0])]);
    expectError(await putBlob(m.token, bytes), 400, 'invalid_blob');
    expect(await blobRows()).toEqual([]);
    expect(entries(m.id)).toEqual([]);
  });

  it('a body shorter than the 30-byte header → 400 invalid_blob', async () => {
    const m = await member('cb-short');
    const bytes = (await webp(16, 8)).subarray(0, 20);
    expectError(await putBlob(m.token, bytes), 400, 'invalid_blob');
    expect(entries(m.id)).toEqual([]);
  });

  it.each([
    ['Content-Type image/png', { contentType: 'image/png' }],
    ['Content-Encoding gzip', { encoding: 'gzip' }],
  ])('%s → 415 unsupported_media; nothing stored', async (_l, opts) => {
    const m = await member('cb-media');
    const bytes = await webp(16, 8);
    const res = await put(sha(bytes), bytes, { token: m.token, ...opts });
    expectError(res, 415, 'unsupported_media');
    expect(await blobRows()).toEqual([]);
    expect(entries(m.id)).toEqual([]);
  });
});

describe('I-16 hash mismatches → 400 hash_mismatch', () => {
  it('correct bytes under another sha in the path: nothing stored, temp removed', async () => {
    const m = await member('cb-hash');
    const bytes = await webp(16, 8);
    const other = sha(Buffer.from('another body'));
    expectError(
      await put(other, bytes, { token: m.token }),
      400,
      'hash_mismatch',
    );
    expect(await blobRows()).toEqual([]);
    expect(entries(m.id)).toEqual([]);
  });

  it.each([
    ['uppercase hex', 'A'.repeat(64)],
    ['63 chars', 'a'.repeat(63)],
    ['not hex', 'z'.repeat(64)],
  ])('a malformed path (%s)', async (_l, path) => {
    const m = await member('cb-path');
    const bytes = await webp(16, 8);
    expectError(
      await put(path, bytes, { token: m.token }),
      400,
      'hash_mismatch',
    );
    expect(entries(m.id)).toEqual([]);
  });
});

describe('I-17 oversize → 413 payload_too_large', () => {
  it(`a declared Content-Length of ${COMPANION_WEBP_MAX_BYTES + 1} → 413 before the body is read`, async () => {
    const m = await member('cb-declared');
    const head = (await webp(16, 8)).subarray(0, 30);
    const req = testApp.request
      .put(`${BLOBS}/${sha(head)}`)
      .set('Content-Type', 'image/webp')
      .set(bearer(m.token))
      .set('Content-Length', String(COMPANION_WEBP_MAX_BYTES + 1));
    // Only 30 of the declared bytes are ever sent: an answer proves the
    // server refused on the header instead of waiting for the body.
    req.write(head);
    expectError(await req, 413, 'payload_too_large');
    expect(entries(m.id)).toEqual([]);
  });

  it('a chunked body (no Content-Length) streaming one byte past the cap → 413; temp removed', async () => {
    const m = await member('cb-stream');
    const head = (await webp(16, 8)).subarray(0, 30);
    const tail = Buffer.alloc(COMPANION_WEBP_MAX_BYTES + 1 - head.length, 0);
    const req = testApp.request
      .put(`${BLOBS}/${sha(Buffer.concat([head, tail]))}`)
      .set('Content-Type', 'image/webp')
      .set(bearer(m.token));
    req.write(head);
    req.write(tail);
    expectError(await req, 413, 'payload_too_large');
    expect(await blobRows()).toEqual([]);
    expect(entries(m.id)).toEqual([]);
  });
});

describe('I-18 refs in either order', () => {
  it('message ref first (dangling ref recorded), then the matching PUT → 201', async () => {
    const m = await member('cb-ref-first');
    const bytes = await webp(16, 8);
    const ref = refOf(bytes, 16, 8);
    expect((await postWithThumbnail(m.token, ref)).status).toBe(202);
    const refRow = [
      m.id,
      ref.sha256,
      BG3_SAVE_CONTRACT_ID,
      bytes.length,
      16,
      8,
    ];
    expect(await refRows()).toEqual([refRow]);
    expect(await blobRows()).toEqual([]);
    expectAck(await putBlob(m.token, bytes), 'stored', ref.sha256);
    expect(await refRows()).toEqual([refRow]);
  });

  it('a ref with another width, then the PUT → 409 blob_ref_mismatch; nothing stored', async () => {
    const m = await member('cb-ref-wrong');
    const bytes = await webp(16, 8);
    const ref = refOf(bytes, 17, 8);
    expect((await postWithThumbnail(m.token, ref)).status).toBe(202);
    expectError(await putBlob(m.token, bytes), 409, 'blob_ref_mismatch');
    expect(await blobRows()).toEqual([]);
    expect(entries(m.id)).toEqual([]);
  });

  it('blob first, then a message whose ref disagrees → 409; no ref, no marker, handler not called', async () => {
    const m = await member('cb-blob-first');
    const bytes = await webp(16, 8);
    expectAck(await putBlob(m.token, bytes), 'stored', sha(bytes));
    const res = await postWithThumbnail(m.token, refOf(bytes, 16, 9));
    expectError(res, 409, 'blob_ref_mismatch');
    expect(await refRows()).toEqual([]);
    expect(
      await testApp.db.select().from(schema.companionIngestLatest),
    ).toEqual([]);
    expect(handle).not.toHaveBeenCalled();
  });

  it('blob first, then a matching message → 202 and a ref row', async () => {
    const m = await member('cb-blob-match');
    const bytes = await webp(16, 8);
    expectAck(await putBlob(m.token, bytes), 'stored', sha(bytes));
    expect((await postWithThumbnail(m.token, refOf(bytes, 16, 8))).status).toBe(
      202,
    );
    expect(await refRows()).toEqual([
      [m.id, sha(bytes), BG3_SAVE_CONTRACT_ID, bytes.length, 16, 8],
    ]);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe('I-19 auth failures → 401 unauthorized', () => {
  it('no Authorization header', async () => {
    const bytes = await webp(16, 8);
    expectError(await put(sha(bytes), bytes), 401, 'unauthorized');
    expect(await blobRows()).toEqual([]);
  });

  it('a revoked device', async () => {
    const m = await member('cb-revoked');
    const del = await testApp.request
      .delete(`/companion/v1/devices/${m.deviceId}`)
      .set(bearer(m.session));
    expect(del.status).toBe(204);
    const bytes = await webp(16, 8);
    expectError(await putBlob(m.token, bytes), 401, 'unauthorized');
    expect(entries(m.id)).toEqual([]);
  });

  it("a deactivated owner's device", async () => {
    const m = await member('cb-deactivated');
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, m.id));
    expectError(await putBlob(m.token, await webp(16, 8)), 401, 'unauthorized');
  });

  it('a revoke landing between the guard and the insert → 401; no row, no file, no temp', async () => {
    const m = await member('cb-revoke-race');
    const repo = testApp.app.get(CompanionBlobsRepository);
    const real = repo.usage.bind(repo);
    jest.spyOn(repo, 'usage').mockImplementationOnce(async (userId) => {
      await testApp.db
        .update(schema.companionDevices)
        .set({ revokedAt: new Date() })
        .where(eq(schema.companionDevices.id, m.deviceId));
      return real(userId);
    });
    expectError(await putBlob(m.token, await webp(16, 8)), 401, 'unauthorized');
    expect(await blobRows()).toEqual([]);
    expect(entries(m.id)).toEqual([]);
  });
});

describe('I-19 session auth', () => {
  it('an impersonation session → 401', async () => {
    const target = await makeUser(testApp, 'cb-imp-target');
    const [admin] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:cb-imp-admin@test.local',
          username: 'cb-imp-admin',
          role: 'admin',
        })
        .returning({ id: schema.users.id }),
      'admin',
    );
    const token = await signTestAccessToken(testApp, {
      sub: target.id,
      username: 'cb-imp-target',
      role: 'member',
      impersonatedBy: admin.id,
    });
    expectError(await putBlob(token, await webp(16, 8)), 401, 'unauthorized');
    expect(await blobRows()).toEqual([]);
  });
});

describe('I-19 per-user scope', () => {
  it('a second user PUTting the same sha → 201 stored (own copy, no cross-user oracle)', async () => {
    const a = await member('cb-owner-a');
    const b = await member('cb-owner-b');
    const bytes = await webp(16, 8);
    const hash = sha(bytes);
    expectAck(await putBlob(a.token, bytes), 'stored', hash);
    expectAck(await putBlob(b.token, bytes), 'stored', hash);
    expect(await blobRows()).toEqual(
      [
        [a.id, hash],
        [b.id, hash],
      ].sort(),
    );
    expect(existsSync(blobFile(a.id, hash))).toBe(true);
    expect(existsSync(blobFile(b.id, hash))).toBe(true);
  });
});

describe('R1 a row whose file is gone (crash / DB restore)', () => {
  it('re-PUT → 201 stored again: the stale row is replaced and the file restored', async () => {
    const u = await member('cb-stale');
    // Older than the 5-minute in-flight window, so it reads as stale.
    const { bytes, hash } = await storedBlob(u.token, u.id, 40, 6 * 60_000);
    rmSync(blobFile(u.id, hash));
    expectAck(await putBlob(u.token, bytes), 'stored', hash);
    expect(readFileSync(blobFile(u.id, hash)).equals(bytes)).toBe(true);
    expect(await blobRows()).toEqual([[u.id, hash]]);
    expect(entries(u.id)).toEqual([`${hash}.webp`]);
  });

  it('a row younger than 5 minutes is kept (an in-flight upload may still rename) → 200 exists', async () => {
    const u = await member('cb-young');
    const { bytes, hash } = await storedBlob(u.token, u.id, 40, 60_000);
    rmSync(blobFile(u.id, hash));
    expectAck(await putBlob(u.token, bytes), 'exists', hash);
    expect(await blobRows()).toEqual([[u.id, hash]]);
    expect(entries(u.id)).toEqual([]);
  });
});

describe('R1 session uploads need a handler opt-in', () => {
  it('device-only handlers → a session PUT is 401; opting the handler into session → 201', async () => {
    const u = await member('cb-session');
    const bytes = await webp(16, 8);
    expectError(await putBlob(u.session, bytes), 401, 'unauthorized');
    expect(await blobRows()).toEqual([]);
    handler.sources = ['device', 'session'];
    try {
      expectAck(await putBlob(u.session, bytes), 'stored', sha(bytes));
    } finally {
      delete handler.sources;
    }
  });
});

describe('I-20 the per-user quota → 413 blob_quota_exceeded', () => {
  it('declared length: the second blob past the quota is refused; the other user is unaffected', async () => {
    const m = await member('cb-quota');
    const other = await member('cb-quota-other');
    const first = await webp(16, 8, 10);
    const second = await webp(16, 8, 200);
    const quota = String(first.length + second.length - 1);
    await withEnv({ COMPANION_BLOB_QUOTA_BYTES_PER_USER: quota }, async () => {
      expectAck(await putBlob(m.token, first), 'stored', sha(first));
      expectError(await putBlob(m.token, second), 413, 'blob_quota_exceeded');
      expectAck(await putBlob(other.token, second), 'stored', sha(second));
    });
    expect(entries(m.id)).toEqual([`${sha(first)}.webp`]);
    expect(await blobRows()).toEqual(
      [
        [m.id, sha(first)],
        [other.id, sha(second)],
      ].sort(),
    );
  });

  it('chunked (no declared length): the in-transaction re-check refuses it; temp removed', async () => {
    const m = await member('cb-quota-chunked');
    const first = await webp(16, 8, 10);
    const second = await webp(16, 8, 200);
    const quota = String(first.length + second.length - 1);
    await withEnv({ COMPANION_BLOB_QUOTA_BYTES_PER_USER: quota }, async () => {
      expectAck(await putBlob(m.token, first), 'stored', sha(first));
      const req = testApp.request
        .put(`${BLOBS}/${sha(second)}`)
        .set('Content-Type', 'image/webp')
        .set(bearer(m.token));
      req.write(second);
      expectError(await req, 413, 'blob_quota_exceeded');
    });
    expect(entries(m.id)).toEqual([`${sha(first)}.webp`]);
    expect(await blobRows()).toEqual([[m.id, sha(first)]]);
  });
});

/** Store a blob over HTTP and backdate its row by `ageMs`. */
async function storedBlob(
  token: string,
  userId: number,
  red: number,
  ageMs: number,
) {
  const bytes = await webp(16, 8, red);
  const hash = sha(bytes);
  expectAck(await putBlob(token, bytes), 'stored', hash);
  await testApp.db
    .update(schema.companionBlobs)
    .set({ createdAt: new Date(Date.now() - ageMs) })
    .where(
      and(
        eq(schema.companionBlobs.userId, userId),
        eq(schema.companionBlobs.sha256, hash),
      ),
    );
  return { bytes, hash };
}

/** Insert a ref row aged by `ageMs`. */
async function ref(userId: number, hash: string, ageMs: number) {
  await testApp.db.insert(schema.companionBlobRefs).values({
    userId,
    sha256: hash,
    contract: BG3_SAVE_CONTRACT_ID,
    byteLength: 100,
    width: 16,
    height: 8,
    referencedAt: new Date(Date.now() - ageMs),
  });
}

/** Write a file into the user's folder with an mtime `ageMs` ago. */
function strayFile(userId: number, name: string, ageMs: number): string {
  const dir = join(root, String(userId));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, 'x');
  const at = new Date(Date.now() - ageMs);
  utimesSync(file, at, at);
  return file;
}

describe('I-21 the orphan cleanup (runOnce, real SQL)', () => {
  it('reaps unreferenced >24 h blobs (row + file), dangling >7 d refs and stale stray files; keeps the rest', async () => {
    const m = await member('cb-cleanup');
    const orphan = await storedBlob(m.token, m.id, 1, 25 * HOUR);
    const fresh = await storedBlob(m.token, m.id, 2, 1 * HOUR);
    const kept = await storedBlob(m.token, m.id, 3, 25 * HOUR);
    await ref(m.id, kept.hash, 8 * DAY); // old, but its blob exists → kept
    const gone = sha(Buffer.from('upload never came'));
    const waiting = sha(Buffer.from('upload still pending'));
    await ref(m.id, gone, 8 * DAY);
    await ref(m.id, waiting, 6 * DAY);
    const strayOld = strayFile(
      m.id,
      `${sha(Buffer.from('stray'))}.webp`,
      25 * HOUR,
    );
    const tempOld = strayFile(m.id, '.upload-0123456789abcdef.tmp', 25 * HOUR);
    const tempNew = strayFile(m.id, '.upload-fedcba9876543210.tmp', 1 * HOUR);

    const counts = await testApp.app.get(CompanionBlobCleanupService).runOnce();

    expect(counts).toEqual({ blobs: 1, refs: 1, files: 2 });
    expect(await blobRows()).toEqual(
      [
        [m.id, fresh.hash],
        [m.id, kept.hash],
      ].sort(),
    );
    expect(existsSync(blobFile(m.id, orphan.hash))).toBe(false);
    expect(existsSync(blobFile(m.id, fresh.hash))).toBe(true);
    expect(existsSync(blobFile(m.id, kept.hash))).toBe(true);
    const refShas = (await refRows()).map((r) => r[1]).sort();
    expect(refShas).toEqual([kept.hash, waiting].sort());
    expect([
      existsSync(strayOld),
      existsSync(tempOld),
      existsSync(tempNew),
    ]).toEqual([false, false, true]);
  });
});

describe('I-21 releaseRefs then cleanup', () => {
  it('a released ref lets the next run reap its aged blob', async () => {
    const m = await member('cb-release');
    const blob = await storedBlob(m.token, m.id, 4, 25 * HOUR);
    await ref(m.id, blob.hash, 1 * HOUR);
    const cleanup = testApp.app.get(CompanionBlobCleanupService);
    expect((await cleanup.runOnce()).blobs).toBe(0);
    const repo = testApp.app.get(CompanionBlobsRepository);
    expect(
      await repo.releaseRefs(m.id, BG3_SAVE_CONTRACT_ID, [blob.hash]),
    ).toBe(1);
    expect((await cleanup.runOnce()).blobs).toBe(1);
    expect(await blobRows()).toEqual([]);
    expect(existsSync(blobFile(m.id, blob.hash))).toBe(false);
  });
});
