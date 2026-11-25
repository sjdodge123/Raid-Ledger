import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from '../test/test-database';
import { readJournal } from './migration-status';
import { DEFAULT_MIGRATIONS_FOLDER, main, runCli } from './run-migrations';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** A copy of the hub migrations whose journal drops the last entry. */
function truncatedFolder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'relayhub-mig-'));
  cpSync(DEFAULT_MIGRATIONS_FOLDER, dir, { recursive: true });
  const file = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(file, 'utf8')) as {
    entries: unknown[];
  };
  journal.entries = journal.entries.slice(0, -1);
  writeFileSync(file, JSON.stringify(journal));
  return dir;
}

async function statusOf(url: string): Promise<unknown> {
  const lines: string[] = [];
  await main(['--status'], { DATABASE_URL: url }, (l) => lines.push(l));
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? 'null');
}

async function query<T extends object>(
  url: string,
  text: string,
): Promise<T[]> {
  const sql = postgres(url, { max: 1 });
  try {
    return await sql.unsafe<T[]>(text);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function countApplied(url: string): Promise<string | undefined> {
  const rows = await query<{ n: string }>(
    url,
    'SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations',
  );
  return rows[0]?.n;
}

describe('relay-hub migration runner (integration)', () => {
  const journal = readJournal(DEFAULT_MIGRATIONS_FOLDER);
  const head = journal.at(-1)?.tag ?? null;
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });
  afterEach(async () => {
    await db.drop();
  });

  it('AC1: applies every migration from empty, then nothing; seeds catalog_epoch', async () => {
    const exit = jest.fn();
    await runCli([], { DATABASE_URL: db.url }, exit);
    expect(exit).toHaveBeenCalledWith(0);
    expect(await countApplied(db.url)).toBe(String(journal.length));
    await runCli([], { DATABASE_URL: db.url }, exit);
    expect(exit).toHaveBeenLastCalledWith(0);
    expect(await countApplied(db.url)).toBe(String(journal.length));
    const rows = await query<{ value: string }>(
      db.url,
      "SELECT value FROM hub_meta WHERE key = 'catalog_epoch'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toMatch(ISO_UTC);
  });

  it('AC6: --status reports null/head/all pending on an empty DB', async () => {
    expect(await statusOf(db.url)).toEqual({
      applied: null,
      head,
      pending: journal.length,
    });
  });

  it('AC6: --status reports pending 1 with all but the last applied, then 0', async () => {
    const folder = truncatedFolder();
    try {
      await main([], { DATABASE_URL: db.url, HUB_MIGRATIONS_FOLDER: folder });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
    expect(await statusOf(db.url)).toEqual({
      applied: journal.at(-2)?.tag ?? null,
      head,
      pending: 1,
    });
    await main([], { DATABASE_URL: db.url });
    expect(await statusOf(db.url)).toEqual({ applied: head, head, pending: 0 });
  });

  it('AC6: --status exits 0 through the CLI path', async () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const exit = jest.fn();
    await runCli(['--status'], { DATABASE_URL: db.url }, exit);
    write.mockRestore();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
