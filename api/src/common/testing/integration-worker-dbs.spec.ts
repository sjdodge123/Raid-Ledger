/**
 * Unit spec for the ROK-2206 per-worker integration DB helpers (no DB).
 * The clone/template SQL is covered by the fleet proof run, not here.
 */
import {
  WORKER_DB_URLS_ENV,
  databaseName,
  requestedWorkers,
  templateDbName,
  withDatabase,
  workerDbUrl,
} from './integration-worker-dbs';

const BASE = 'postgresql://user:password@localhost:5432/raid_ledger_test';
const KEYS = ['RL_INTEGRATION_WORKERS', WORKER_DB_URLS_ENV, 'JEST_WORKER_ID'];
const saved = KEYS.map((k) => process.env[k]);

afterEach(() => {
  KEYS.forEach((k, i) => {
    const v = saved[i];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
});

describe('requestedWorkers', () => {
  it.each([undefined, '1', '0', '-2', 'abc', '2.5', ''])(
    'is 1 (flag off) for %p',
    (value) => {
      if (value === undefined) delete process.env.RL_INTEGRATION_WORKERS;
      else process.env.RL_INTEGRATION_WORKERS = value;
      expect(requestedWorkers()).toBe(1);
    },
  );

  it('returns the count for an integer >= 2', () => {
    process.env.RL_INTEGRATION_WORKERS = '3';
    expect(requestedWorkers()).toBe(3);
  });
});

describe('URL helpers', () => {
  it('swaps only the database name', () => {
    expect(withDatabase(BASE, 'raid_ledger_test_w2')).toBe(
      'postgresql://user:password@localhost:5432/raid_ledger_test_w2',
    );
  });

  it('names the template <base>_tpl', () => {
    expect(databaseName(BASE)).toBe('raid_ledger_test');
    expect(templateDbName(BASE)).toBe('raid_ledger_test_tpl');
  });
});

describe('workerDbUrl', () => {
  const urls = [1, 2].map((i) => withDatabase(BASE, `raid_ledger_test_w${i}`));

  it('maps JEST_WORKER_ID 1..N to the matching clone', () => {
    process.env[WORKER_DB_URLS_ENV] = urls.join(' ');
    process.env.JEST_WORKER_ID = '1';
    expect(workerDbUrl()).toBe(urls[0]);
    process.env.JEST_WORKER_ID = '2';
    expect(workerDbUrl()).toBe(urls[1]);
  });

  it('is undefined with fewer than 2 URLs (flag off)', () => {
    delete process.env[WORKER_DB_URLS_ENV];
    expect(workerDbUrl()).toBeUndefined();
    process.env[WORKER_DB_URLS_ENV] = urls[0] ?? '';
    expect(workerDbUrl()).toBeUndefined();
  });

  it.each(['0', '3', 'x'])('is undefined for worker id %p', (id) => {
    process.env[WORKER_DB_URLS_ENV] = urls.join(' ');
    process.env.JEST_WORKER_ID = id;
    expect(workerDbUrl()).toBeUndefined();
  });
});
