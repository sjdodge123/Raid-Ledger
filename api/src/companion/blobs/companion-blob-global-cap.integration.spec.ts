/**
 * ROK-1956 Codex P1 — the global blob disk cap (`COMPANION_BLOB_TOTAL_MAX_BYTES`)
 * holds under concurrency and for chunked bodies: every upload reserves its
 * worst case under one global lock before streaming, so the stored total can
 * never pass the cap. Real HTTP + Postgres; blob root is a per-file tmpdir.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Response } from 'supertest';
import { COMPANION_WEBP_MAX_BYTES } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
  withEnv,
} from '../devices/testing/companion-link.helpers';

const BLOBS = '/companion/v1/blobs';
let testApp: TestApp;
let root = '';
const priorDir = process.env.COMPANION_BLOB_DIR;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'rl-companion-blob-cap-'));
  process.env.COMPANION_BLOB_DIR = root;
  testApp = await getTestApp();
});

beforeEach(() => expireLimiterWindows(testApp));

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  for (const name of readdirSync(root)) {
    rmSync(join(root, name), { recursive: true, force: true });
  }
});

afterAll(() => {
  if (priorDir === undefined) delete process.env.COMPANION_BLOB_DIR;
  else process.env.COMPANION_BLOB_DIR = priorDir;
  rmSync(root, { recursive: true, force: true });
});

function webp(red: number): Promise<Buffer> {
  const create = {
    width: 16,
    height: 8,
    channels: 3,
    background: { r: red, g: 20, b: 30 },
  } as const;
  return sharp({ create }).webp({ lossless: true }).toBuffer();
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function deviceToken(name: string): Promise<string> {
  const user = await makeUser(testApp, name);
  return (await linkDevice(testApp, user.token)).token;
}

/** PUT with a declared Content-Length (supertest sets it for a Buffer). */
function putDeclared(token: string, bytes: Buffer) {
  return testApp.request
    .put(`${BLOBS}/${sha(bytes)}`)
    .set('Content-Type', 'image/webp')
    .set(bearer(token))
    .serialize((b) => b)
    .send(bytes);
}

/** PUT a chunked body (no Content-Length). */
function putChunked(token: string, bytes: Buffer) {
  const req = testApp.request
    .put(`${BLOBS}/${sha(bytes)}`)
    .set('Content-Type', 'image/webp')
    .set(bearer(token));
  req.write(bytes);
  return req;
}

const codeOf = (res: Response): unknown =>
  (res.body as { code?: unknown }).code;

async function storedBytes(): Promise<number> {
  const rows = await testApp.db.select().from(schema.companionBlobs);
  return rows.reduce((n, r) => n + r.byteLength, 0);
}

async function leftovers(): Promise<{ holds: number; temps: string[] }> {
  const holds = await testApp.db
    .select()
    .from(schema.companionBlobReservations);
  const temps = readdirSync(root).flatMap((d) =>
    existsSync(join(root, d))
      ? readdirSync(join(root, d)).filter((f) => f.endsWith('.tmp'))
      : [],
  );
  return { holds: holds.length, temps };
}

describe('Codex P1 the global disk cap → 413 blob_quota_exceeded', () => {
  it('four concurrent uploads that together pass the cap: stored bytes stay ≤ the cap, the rest are 413', async () => {
    const bodies = await Promise.all([10, 70, 130, 190].map((r) => webp(r)));
    const uploads = await Promise.all(
      bodies.map(async (bytes, i) => ({
        bytes,
        token: await deviceToken(`cb-cap-${i}`),
      })),
    );
    const largest = Math.max(...bodies.map((b) => b.length));
    const cap = Math.floor(largest * 2.5);
    const results = await withEnv(
      { COMPANION_BLOB_TOTAL_MAX_BYTES: String(cap) },
      () => Promise.all(uploads.map((u) => putDeclared(u.token, u.bytes))),
    );
    const statuses = results.map((r) => [r.status, codeOf(r) ?? null]);
    const stored = statuses.filter(([s]) => s === 201).length;
    const refused = statuses.filter(
      ([s, c]) => s === 413 && c === 'blob_quota_exceeded',
    ).length;
    expect({ stored, refused, total: statuses.length }).toEqual({
      stored: 2,
      refused: 2,
      total: 4,
    });
    expect(await storedBytes()).toBeLessThanOrEqual(cap);
    expect(await leftovers()).toEqual({ holds: 0, temps: [] });
  });

  it('a chunked upload is counted at the contract max: refused where the same bytes declared fit', async () => {
    const token = await deviceToken('cb-cap-chunked');
    const first = await webp(10);
    const second = await webp(200);
    const cap = COMPANION_WEBP_MAX_BYTES + first.length - 1;
    await withEnv({ COMPANION_BLOB_TOTAL_MAX_BYTES: String(cap) }, async () => {
      expect((await putDeclared(token, first)).status).toBe(201);
      const chunked = await putChunked(token, second);
      expect([chunked.status, codeOf(chunked)]).toEqual([
        413,
        'blob_quota_exceeded',
      ]);
      expect((await putDeclared(token, second)).status).toBe(201);
    });
    expect(await storedBytes()).toBe(first.length + second.length);
    expect(await leftovers()).toEqual({ holds: 0, temps: [] });
  });
});
