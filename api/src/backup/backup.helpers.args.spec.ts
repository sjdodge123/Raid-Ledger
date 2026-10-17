/**
 * ROK-1413: every RESTORE path (direct + docker) and the DEV dump path must
 * carry `--exclude-schema=drizzle`. Restoring the `drizzle` schema re-imports
 * migration metadata, causing cross-branch hash drift + silently-skipped
 * migrations (the incident ROK-1413 closed).
 *
 * ROK-1160 D4 (operator ruling 2026-09-22, option b): the PROD dump path
 * (`runPgDumpDirect`) KEEPS the journal, so a restored prod backup carries the
 * `drizzle.__drizzle_migrations` rows that match its `public` schema. Proven at
 * the arg-builder level — no live pg_dump/pg_restore process is spawned.
 */
import * as childProcess from 'node:child_process';
import {
  pgDumpArgs,
  pgRestoreArgs,
  runPgDumpDirect,
  runPgDumpDocker,
  runPgRestoreDirect,
  runPgRestoreDocker,
} from './backup.helpers';

jest.mock('node:child_process');

const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

/** Resolve the promisified execFile mock to a success result. */
function mockExecFileSuccess(): void {
  (mockChildProcess.execFile as unknown as jest.Mock).mockImplementation(
    (...args: unknown[]) => {
      const callback = args.find((a) => typeof a === 'function') as
        | ((
            err: Error | null,
            result?: { stdout: string; stderr: string },
          ) => void)
        | undefined;
      callback?.(null, { stdout: '', stderr: '' });
    },
  );
}

/** Args array of the first execFile call whose command equals `cmd`. */
function argsForCommand(cmd: string): string[] | undefined {
  const calls = (mockChildProcess.execFile as unknown as jest.Mock).mock.calls;
  const call = calls.find((c: unknown[]) => c[0] === cmd);
  return call?.[1] as string[] | undefined;
}

/** Args of the `docker exec <container> <cmd> ...` call that runs `cmd`. */
function dockerExecArgsFor(cmd: string): string[] | undefined {
  const calls = (mockChildProcess.execFile as unknown as jest.Mock).mock.calls;
  const call = calls.find(
    (c: unknown[]) =>
      c[0] === 'docker' &&
      Array.isArray(c[1]) &&
      (c[1] as string[])[0] === 'exec' &&
      (c[1] as string[]).includes(cmd),
  );
  return call?.[1] as string[] | undefined;
}

const DB_URL = 'postgresql://user:pass@localhost:5432/raid_ledger';

describe('backup arg builders and the drizzle schema (ROK-1413, ROK-1160 D4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFileSuccess();
  });

  describe('pgDumpArgs', () => {
    it('includes --exclude-schema=drizzle and keeps the dbUrl last', () => {
      const args = pgDumpArgs('/out.dump', DB_URL);
      expect(args).toContain('--exclude-schema=drizzle');
      expect(args).toContain('--format=custom');
      expect(args[args.length - 1]).toBe(DB_URL);
    });

    it('still emits --exclude-table-data flags alongside the schema exclusion', () => {
      const args = pgDumpArgs('/out.dump', DB_URL, ['app_settings']);
      expect(args).toContain('--exclude-schema=drizzle');
      expect(args).toContain('--exclude-table-data=app_settings');
    });

    it('keepJournal drops ONLY the drizzle exclusion (D4 prod dumps)', () => {
      const args = pgDumpArgs('/out.dump', DB_URL, ['app_settings'], {
        keepJournal: true,
      });
      expect(args).not.toContain('--exclude-schema=drizzle');
      expect(args).toEqual(
        pgDumpArgs('/out.dump', DB_URL, ['app_settings']).filter(
          (a) => a !== '--exclude-schema=drizzle',
        ),
      );
    });
  });

  describe('pgRestoreArgs', () => {
    it('includes --exclude-schema=drizzle and keeps the input path last', () => {
      const args = pgRestoreArgs(DB_URL, '/in.dump');
      expect(args).toContain('--exclude-schema=drizzle');
      expect(args).toContain('--clean');
      expect(args).toContain('--if-exists');
      expect(args).toContain(`--dbname=${DB_URL}`);
      expect(args[args.length - 1]).toBe('/in.dump');
    });
  });

  describe('the prod dump path keeps the journal (ROK-1160 D4)', () => {
    it('runPgDumpDirect dumps WITH the drizzle schema', async () => {
      await runPgDumpDirect('/out.dump', DB_URL);
      const args = argsForCommand('pg_dump');
      expect(args).toContain('--file=/out.dump');
      expect(args).not.toContain('--exclude-schema=drizzle');
    });
  });

  describe('the dev dump path and both restore paths carry the exclusion', () => {
    it('runPgDumpDocker', async () => {
      await runPgDumpDocker('/out.dump', DB_URL, 'raid-ledger-db');
      expect(dockerExecArgsFor('pg_dump')).toContain(
        '--exclude-schema=drizzle',
      );
    });

    it('runPgRestoreDirect', async () => {
      await runPgRestoreDirect('/in.dump', DB_URL);
      expect(argsForCommand('pg_restore')).toContain(
        '--exclude-schema=drizzle',
      );
    });

    it('runPgRestoreDocker', async () => {
      await runPgRestoreDocker('/in.dump', DB_URL, 'raid-ledger-db');
      expect(dockerExecArgsFor('pg_restore')).toContain(
        '--exclude-schema=drizzle',
      );
    });
  });
});
