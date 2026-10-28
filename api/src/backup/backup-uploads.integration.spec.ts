/**
 * ROK-2023 — companion `/data/uploads` archive, end to end: real Postgres
 * (pg_dump runs direct against the Testcontainers DB), real files in a
 * tmpdir uploads root, the system `tar`, and the admin HTTP routes.
 *
 * Gated by SKIP_BACKUP_INTEGRATION like backup.integration.spec.ts (machines
 * without pg_dump). BACKUP_DIR is sandboxed before the app boots; the daily
 * dir is still resolved from the service rather than assumed.
 * BACKUP_UPLOADS_DIR is read per call (spec D6), so each case can repoint it.
 * No afterAll truncate (shared pool) — this suite writes no DB rows.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { BackupService } from './backup.service';

const execFileAsync = promisify(execFile);

const SKIP_BACKUP_INTEGRATION = process.env.SKIP_BACKUP_INTEGRATION === '1';
const describeBackup = SKIP_BACKUP_INTEGRATION ? describe.skip : describe;

process.env.DB_CONTAINER_NAME = '';
const SANDBOX = SKIP_BACKUP_INTEGRATION
  ? ''
  : fs.mkdtempSync(path.join(os.tmpdir(), 'rl-backup-uploads-'));
if (!SKIP_BACKUP_INTEGRATION) {
  process.env.BACKUP_DIR = path.join(SANDBOX, 'backups');
}
const UPLOADS_DIR = path.join(SANDBOX, 'uploads');
const MEDIA_UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SEEDED = {
  'feedback/1.png': 'png-bytes',
  [`hub-media/7/${MEDIA_UUID}.webp`]: 'webp-bytes',
  [`hub-media/7/${MEDIA_UUID}.thumb.webp`]: 'thumb-bytes',
} as const;

function seedUploads(): void {
  for (const [rel, body] of Object.entries(SEEDED)) {
    const file = path.join(UPLOADS_DIR, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
}

async function tarList(archive: string): Promise<string[]> {
  const { stdout } = await execFileAsync('tar', ['-tf', archive]);
  return stdout.split('\n').filter((line) => line.length > 0);
}

function describeUploadsArchive() {
  let testApp: TestApp;
  let adminToken: string;
  let dailyDir = '';
  const created: string[] = [];

  /** POST /admin/backups; returns the dump filename and records it for cleanup. */
  async function createBackup(): Promise<string> {
    const res = await testApp.request
      .post('/admin/backups')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(201);
    const filename = String(res.body.backup.filename);
    const service = testApp.app.get(BackupService);
    dailyDir = path.dirname(service.getBackupFilePath('daily', filename));
    created.push(filename, filename.replace(/\.dump$/, '.uploads.tar'));
    return filename;
  }

  const inDaily = (name: string): string => path.join(dailyDir, name);
  const archiveOf = (dump: string): string =>
    inDaily(dump.replace(/\.dump$/, '.uploads.tar'));

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(() => {
    fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
    process.env.BACKUP_UPLOADS_DIR = UPLOADS_DIR;
  });

  afterEach(() => {
    for (const name of created.splice(0))
      fs.rmSync(inDaily(name), { force: true });
  });

  afterAll(() => {
    delete process.env.BACKUP_UPLOADS_DIR;
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  });

  it('POST writes X.dump and X.uploads.tar (same timestamp) holding the uploads tree (AC1, AC2)', async () => {
    seedUploads();
    const dump = await createBackup();

    expect(dump).toMatch(/^raid_ledger_\d{4}-\d{2}-\d{2}_\d{6}\.dump$/);
    expect(fs.statSync(inDaily(dump)).size).toBeGreaterThan(0);
    expect(fs.existsSync(archiveOf(dump))).toBe(true);
    expect(fs.existsSync(`${archiveOf(dump)}.partial`)).toBe(false);
    const members = await tarList(archiveOf(dump));
    for (const rel of Object.keys(SEEDED))
      expect(members).toContain(`uploads/${rel}`);

    const out = fs.mkdtempSync(path.join(SANDBOX, 'extract-'));
    await execFileAsync('tar', ['-xf', archiveOf(dump), '-C', out]);
    const thumb = `hub-media/7/${MEDIA_UUID}.thumb.webp`;
    expect(fs.readFileSync(path.join(out, 'uploads', thumb), 'utf8')).toBe(
      'thumb-bytes',
    );
  });

  it('DELETE of the dump removes its uploads archive too (AC7)', async () => {
    seedUploads();
    const dump = await createBackup();
    expect(fs.existsSync(archiveOf(dump))).toBe(true);

    const res = await testApp.request
      .delete(`/admin/backups/daily/${dump}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(fs.existsSync(inDaily(dump))).toBe(false);
    expect(fs.existsSync(archiveOf(dump))).toBe(false);
  });

  it('a missing uploads root still writes the dump and no archive (AC3)', async () => {
    process.env.BACKUP_UPLOADS_DIR = path.join(SANDBOX, 'no-such-uploads');
    const dump = await createBackup();

    expect(fs.statSync(inDaily(dump)).size).toBeGreaterThan(0);
    expect(fs.existsSync(archiveOf(dump))).toBe(false);
  });

  it('GET /admin/backups lists the dump but never the archive', async () => {
    seedUploads();
    const dump = await createBackup();
    expect(fs.existsSync(archiveOf(dump))).toBe(true);

    const res = await testApp.request
      .get('/admin/backups')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const names = (res.body.backups as Array<{ filename: string }>).map(
      (b) => b.filename,
    );
    expect(names).toContain(dump);
    expect(names.filter((n) => n.endsWith('.uploads.tar'))).toEqual([]);
  });
}

describeBackup('Backup uploads archive (integration, ROK-2023)', () =>
  describeUploadsArchive(),
);
