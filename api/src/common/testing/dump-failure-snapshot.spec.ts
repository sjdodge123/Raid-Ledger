/**
 * Unit test for `dumpFailureSnapshot` (ROK-1249, AC2).
 *
 * Verifies the helper writes a timestamped JSON file under
 * planning-artifacts/test-infra-snapshots/ containing all five state
 * buckets, plus the supplied reason + request context.
 */
import * as fs from 'fs';
import * as path from 'path';

const TEST_INSTANCE = {
  app: null as unknown,
  redisMock: null as unknown,
  _appClient: null as unknown,
};

jest.mock('./test-app', () => ({
  getTestAppInstance: () => TEST_INSTANCE,
  INSTANCE_KEY: '__raid_ledger_test_app',
}));

import { dumpFailureSnapshot } from './dump-failure-snapshot';

const SNAPSHOT_DIR = path.resolve(
  __dirname,
  '../../../../planning-artifacts/test-infra-snapshots',
);

function buildFakeApp(): unknown {
  return {
    get: () => null,
  };
}

function buildFakeRedisMock(): unknown {
  const store = new Map<string, string>([
    ['bull:test-1-:meta', '{}'],
    ['bull:test-1-:active', '[]'],
    ['jwt_block:abc', '1'],
    ['jwt_block:def', '1'],
    ['jwt_block:ghi', '1'],
    ['settings:cache', '{}'],
  ]);
  return { client: {}, store };
}

function buildFakeAppClient(): unknown {
  return {
    options: { max: 10 },
    unsafe: () => Promise.resolve([{ count: '3' }]),
  };
}

function readLatestSnapshot(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function resetTestInstance(): void {
  TEST_INSTANCE.app = buildFakeApp();
  TEST_INSTANCE.redisMock = buildFakeRedisMock();
  TEST_INSTANCE._appClient = buildFakeAppClient();
}

describe('dumpFailureSnapshot — payload shape', () => {
  beforeEach(resetTestInstance);

  it('writes a JSON snapshot with all five state buckets', async () => {
    const reason = 'socket hang up';
    const context = {
      method: 'POST',
      url: '/admin/test/await-processing',
      elapsedMs: 1234,
    };
    const filePath = await dumpFailureSnapshot(reason, context);
    expect(filePath).toMatch(/snapshot-.*\.json$/);
    expect(fs.existsSync(filePath)).toBe(true);
    const snapshot = readLatestSnapshot(filePath);
    expect(snapshot).toHaveProperty('reason', reason);
    expect(snapshot.context).toMatchObject(context);
    expect(snapshot).toHaveProperty('postgresPool');
    expect(snapshot).toHaveProperty('bullmqWorkers');
    expect(snapshot).toHaveProperty('activeHandles');
    expect(snapshot).toHaveProperty('cronJobs');
    expect(snapshot).toHaveProperty('redisMockStore');
    expect(Array.isArray(snapshot.bullmqWorkers)).toBe(true);
    expect(Array.isArray(snapshot.cronJobs)).toBe(true);
    fs.unlinkSync(filePath);
  });

  it('echoes reason without context when none provided', async () => {
    const filePath = await dumpFailureSnapshot('ECONNRESET');
    const snapshot = readLatestSnapshot(filePath);
    expect(snapshot.reason).toBe('ECONNRESET');
    expect(snapshot.context ?? null).toBeNull();
    fs.unlinkSync(filePath);
  });
});

describe('dumpFailureSnapshot — filesystem + buckets', () => {
  beforeEach(resetTestInstance);

  it('creates the snapshots directory if it does not exist', async () => {
    if (fs.existsSync(SNAPSHOT_DIR)) {
      const entries = fs.readdirSync(SNAPSHOT_DIR);
      if (entries.length === 0) fs.rmdirSync(SNAPSHOT_DIR);
    }
    const filePath = await dumpFailureSnapshot('directory-creation');
    expect(fs.existsSync(SNAPSHOT_DIR)).toBe(true);
    fs.unlinkSync(filePath);
  });

  it('groups redis-mock keys by prefix and samples them', async () => {
    const filePath = await dumpFailureSnapshot('redis-prefix-test');
    const snapshot = readLatestSnapshot(filePath);
    const redis = snapshot.redisMockStore as Record<string, unknown>;
    expect(redis).toHaveProperty('totalKeys');
    expect(redis).toHaveProperty('prefixes');
    const prefixes = redis.prefixes as Record<
      string,
      { count: number; sample: string[] }
    >;
    expect(prefixes['bull']).toBeDefined();
    expect(prefixes['jwt_block']).toBeDefined();
    expect(prefixes['jwt_block'].count).toBe(3);
    fs.unlinkSync(filePath);
  });
});
