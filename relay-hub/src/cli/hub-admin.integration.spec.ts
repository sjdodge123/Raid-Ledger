import { z } from 'zod';
import postgres, { type Sql } from 'postgres';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import { createTestDatabase, type TestDatabase } from '../test/test-database';
import { main } from './hub-admin';

const A = '1a1a1a1a-1111-4111-8111-111111111111';
const B = '2b2b2b2b-2222-4222-8222-222222222222';
const R = '3c3c3c3c-3333-4333-8333-333333333333';
const D = '4d4d4d4d-4444-4444-8444-444444444444';
const HASH_A = 'a'.repeat(64);

// Top-level hooks + tests: one file-wide DB (ROK-1670 L10).
let db: TestDatabase;
let sql: Sql;
let out: string[];
let err: string[];
const run = (...argv: string[]) =>
  main(argv, {
    env: { DATABASE_URL: db.url },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });

beforeAll(async () => {
  db = await createTestDatabase();
  await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
  sql = postgres(db.url, { max: 1, onnotice: () => undefined });
  await sql`INSERT INTO hub_instances (instance_id, token_hash, status,
    version, schema_version, registered_at) VALUES
    (${B}, ${'b'.repeat(64)}, 'pending', '0.0.2', 1, '2026-11-25T02:00:00Z'),
    (${A}, ${HASH_A}, 'pending', '0.0.1', 1, '2026-11-25T01:00:00Z'),
    (${R}, ${'c'.repeat(64)}, 'revoked', '0.0.3', 1, '2026-11-25T01:00:00Z'),
    (${D}, NULL, 'disconnected', '0.0.4', 1, '2026-11-25T03:00:00Z')`;
});
beforeEach(() => {
  out = [];
  err = [];
});
afterAll(async () => {
  await sql.end({ timeout: 5 });
  await db.drop();
});

it('AC5: instances prints one line per instance, sorted, without hashes', async () => {
  expect(await run('instances')).toBe(0);
  expect(out).toHaveLength(4);
  expect(out[0]).toContain(A);
  expect(out[1]).toContain(R);
  expect(out[2]).toContain(B);
  expect(out[3]).toContain(D);
  // R never changes, so this holds whatever order the tests run in.
  expect(out[1]).toContain('revoked  reader  v0.0.3');
  expect(out.join('\n')).not.toContain(HASH_A);
});

it('AC5: --json is deterministic and hash-free', async () => {
  expect(await run('instances', '--json')).toBe(0);
  const first = out.join('\n');
  out = [];
  await run('instances', '--json');
  expect(out.join('\n')).toBe(first);
  expect(first).not.toContain(HASH_A);
  const ids = z
    .array(z.object({ instanceId: z.string() }))
    .parse(JSON.parse(first));
  expect(ids.map((i) => i.instanceId)).toEqual([A, R, B, D]);
  const rows = z
    .array(z.record(z.string(), z.unknown()))
    .parse(JSON.parse(first));
  for (const row of rows) {
    expect(Object.keys(row)).toEqual([
      'instanceId',
      'status',
      'trustTier',
      'version',
      'registeredAt',
      'approvedAt',
      'lastHeartbeatAt',
    ]);
  }
});

it('AC6: approve sets approved/contributor/approved_at, then is a no-op', async () => {
  expect(await run('approve', A)).toBe(0);
  expect(out).toHaveLength(1);
  const [row] = await sql`SELECT status, trust_tier, approved_at
    FROM hub_instances WHERE instance_id = ${A}`;
  expect(row).toMatchObject({
    status: 'approved',
    trust_tier: 'contributor',
  });
  expect(row?.approved_at).toBeInstanceOf(Date);
  expect(await run('approve', A)).toBe(0);
  const [again] = await sql`SELECT approved_at FROM hub_instances
    WHERE instance_id = ${A}`;
  expect(again?.approved_at).toEqual(row?.approved_at);
});

it.each([
  ['an unknown id', '9f9f9f9f-9999-4999-8999-999999999999'],
  ['a revoked id', R],
  ['a disconnected id', D],
])('AC6: approve of %s exits 1 with one error line', async (_l, id) => {
  expect(await run('approve', id)).toBe(1);
  expect(err).toHaveLength(1);
  expect(out).toHaveLength(0);
});

it('AC7: CLI output never carries a hash or the DB password', async () => {
  await run('instances');
  await run('instances', '--json');
  const text = [...out, ...err].join('\n');
  const password = decodeURIComponent(new URL(db.url).password);
  expect(text).not.toContain(HASH_A);
  if (password) expect(text).not.toContain(password);
});
