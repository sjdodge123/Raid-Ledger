/**
 * ROK-1956 review R1 — the cleanup deletes and unlinks only inside the
 * user's blob-lock transaction (the SQL itself is proven by I-21).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CronJobService } from '../../cron-jobs/cron-job.service';
import * as q from './companion-blob-cleanup.queries';
import { CompanionBlobCleanupService } from './companion-blob-cleanup.service';
import type {
  CompanionBlobTx,
  CompanionBlobsRepository,
} from './companion-blobs.repository';

jest.mock('./companion-blob-cleanup.queries', () => ({
  unreferencedBlobUsers: jest.fn(),
  deleteUnreferencedBlobsIn: jest.fn(),
  danglingRefUsers: jest.fn(),
  deleteDanglingRefsIn: jest.fn(),
  storedShasIn: jest.fn(),
}));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const TX = {} as CompanionBlobTx;
const priorDir = process.env.COMPANION_BLOB_DIR;
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rl-cb-cleanup-'));
  process.env.COMPANION_BLOB_DIR = root;
  mkdirSync(join(root, '7'));
  const old = new Date(Date.now() - 48 * 3_600_000);
  for (const sha of [A, B]) {
    const file = join(root, '7', `${sha}.webp`);
    writeFileSync(file, 'x');
    utimesSync(file, old, old);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (priorDir === undefined) delete process.env.COMPANION_BLOB_DIR;
  else process.env.COMPANION_BLOB_DIR = priorDir;
});

const file = (sha: string): string => join(root, '7', `${sha}.webp`);

/** Mocks that log each query, plus a lock that logs which files remain at release. */
function arrange(events: string[]): CompanionBlobCleanupService {
  const repo = {
    reader: {},
    withUserLock: jest.fn(
      async (userId: number, fn: (tx: CompanionBlobTx) => Promise<number>) => {
        events.push(`lock:${userId}`);
        const n = await fn(TX);
        events.push(
          `release:${userId}:A=${existsSync(file(A))}:B=${existsSync(file(B))}`,
        );
        return n;
      },
    ),
  };
  jest
    .mocked(q.unreferencedBlobUsers)
    .mockResolvedValueOnce([7])
    .mockResolvedValue([]);
  jest.mocked(q.deleteUnreferencedBlobsIn).mockImplementation(() => {
    events.push('delete-blob-rows');
    return Promise.resolve([A]);
  });
  jest
    .mocked(q.danglingRefUsers)
    .mockResolvedValueOnce([7])
    .mockResolvedValue([]);
  jest.mocked(q.deleteDanglingRefsIn).mockImplementation(() => {
    events.push('delete-refs');
    return Promise.resolve(2);
  });
  jest.mocked(q.storedShasIn).mockImplementation(() => {
    events.push('stored-shas');
    return Promise.resolve(new Set<string>());
  });
  const cron = {} as CronJobService;
  return new CompanionBlobCleanupService(
    repo as unknown as CompanionBlobsRepository,
    cron,
  );
}

it('every delete + unlink happens between taking and releasing the user lock', async () => {
  const events: string[] = [];
  const service = arrange(events);
  await expect(service.runOnce()).resolves.toEqual({
    blobs: 1,
    refs: 2,
    files: 1,
  });
  expect(events).toEqual([
    'lock:7',
    'delete-blob-rows',
    'release:7:A=false:B=true',
    'lock:7',
    'delete-refs',
    'release:7:A=false:B=true',
    'lock:7',
    'stored-shas',
    'release:7:A=false:B=false',
  ]);
  expect(jest.mocked(q.deleteUnreferencedBlobsIn)).toHaveBeenCalledWith(
    TX,
    7,
    24,
    500,
  );
  expect(jest.mocked(q.storedShasIn)).toHaveBeenCalledWith(TX, 7, [B]);
});
