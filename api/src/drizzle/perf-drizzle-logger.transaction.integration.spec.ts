/**
 * ROK-2177 (td8): in-transaction `[PERF] DB` logging against REAL postgres.js
 * `begin` / `savepoint` — `perf-drizzle-logger.transaction.spec.ts` proves it
 * against a fake client only, so a postgres.js upgrade that changes how
 * `begin` hands out the transaction client would slip past it.
 *
 * Every statement carries `MARK`, so a `[PERF]` line the booted test app
 * emits on its own never reaches an assertion.
 */
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTestApp } from '../common/testing/test-app';
import * as perfLoggerModule from '../common/perf-logger';
import { withQueryPerfLogging } from './perf-drizzle-logger';

const MARK = 'td8-perf-tx';

let client: ReturnType<typeof postgres>;
let perfLogSpy: jest.SpiedFunction<typeof perfLoggerModule.perfLog>;
const previousDebug = process.env.DEBUG;

/** Status + table of each marked `[PERF] DB` line, in emit order. */
function markedLines(): Array<{ status: unknown; table: unknown }> {
  const lines: Array<{ status: unknown; table: unknown }> = [];
  for (const [category, , , meta] of perfLogSpy.mock.calls) {
    if (category !== 'DB' || !String(meta?.query ?? '').includes(MARK))
      continue;
    lines.push({ status: meta?.status, table: meta?.table });
  }
  return lines;
}

beforeAll(async () => {
  // ROK-2206: the app's own DB (the worker clone in per-worker mode).
  const { connectionString } = await getTestApp();
  process.env.DEBUG = 'true';
  client = withQueryPerfLogging(postgres(connectionString, { max: 1 }));
});

beforeEach(() => {
  perfLogSpy = jest
    .spyOn(perfLoggerModule, 'perfLog')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  perfLogSpy.mockRestore();
});

afterAll(async () => {
  if (previousDebug === undefined) delete process.env.DEBUG;
  else process.env.DEBUG = previousDebug;
  await client.end();
});

describe('withQueryPerfLogging — real postgres.js transactions', () => {
  it('logs each statement of a drizzle transaction and its savepoint', async () => {
    const db = drizzle(client);
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SELECT 1 /* ${MARK} */ FROM pg_class LIMIT 1`));
      await tx.transaction(async (sp) => {
        await sp.execute(
          sql.raw(`SELECT 1 /* ${MARK} */ FROM pg_type LIMIT 1`),
        );
      });
    });
    expect(markedLines()).toEqual([
      { status: 'ok', table: 'pg_class' },
      { status: 'ok', table: 'pg_type' },
    ]);
  });

  it('passes an array returned from the begin() callback through as-is', async () => {
    const result = await client.begin(async (tx) => {
      await tx.unsafe(`SELECT 1 /* ${MARK} */ FROM pg_class LIMIT 1`);
      return [1, 2];
    });
    expect(result).toEqual([1, 2]);
    expect(markedLines()).toEqual([{ status: 'ok', table: 'pg_class' }]);
  });

  it('rethrows a failing statement and logs it as err', async () => {
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`SELECT 1 /* ${MARK} */ FROM td8_no_such_table`);
      }),
    ).rejects.toThrow('td8_no_such_table');
    expect(markedLines()).toEqual([
      { status: 'err', table: 'td8_no_such_table' },
    ]);
  });
});
