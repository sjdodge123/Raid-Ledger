/**
 * Backup Service Integration Tests
 *
 * Verifies backup create, list, delete, and restore against a real PostgreSQL
 * database. Uses direct pg_dump/pg_restore execution (DB_CONTAINER_NAME='')
 * since the Testcontainers DB isn't the named raid-ledger-db container.
 *
 * IMPORTANT: Uses an isolated temp directory for backups (BACKUP_DIR) so tests
 * never touch real backup files in the project's backups/ directory.
 *
 * These tests confirm that:
 * - Backups produce valid pg_dump files that actually contain data
 * - Listed backups reflect real files on disk
 * - Restore brings back data that was present at backup time
 * - Delete removes the file and it disappears from the list
 * - Auth is enforced on all backup endpoints
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  reseedAdminCreds,
} from '../common/testing/integration-helpers';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JwtService } from '@nestjs/jwt';
import { eq, sql } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as schema from '../drizzle/schema';
import { BackupService } from './backup.service';

const execFileAsync = promisify(execFile);

// The four tables whose row data must NOT appear in any dump produced by
// BackupService (schema entries still present; only the COPY/INSERT data
// segments are excluded via `pg_dump --exclude-table-data=<t>`).
const SANITIZED_EXCLUDED_TABLES = [
  'app_settings',
  'local_credentials',
  'sessions',
  'consumed_intent_tokens',
] as const;

// Allow opting out locally when pg_dump/pg_restore are not on PATH.
// validate-ci.sh sets this when it detects a missing pg_dump binary in
// non-CI mode. In CI the env var is never set, so the suite always runs.
const SKIP_BACKUP_INTEGRATION = process.env.SKIP_BACKUP_INTEGRATION === '1';
const describeBackup = SKIP_BACKUP_INTEGRATION ? describe.skip : describe;

// Force direct pg_dump/pg_restore execution (no Docker routing)
// so it works with the Testcontainers DB.
process.env.DB_CONTAINER_NAME = '';

// Isolate test backups in a temp directory so we never touch real backup files.
// Skip directory creation when the suite is gated off — it would leak temp dirs
// every run on machines without pg_dump.
const TEST_BACKUP_DIR = SKIP_BACKUP_INTEGRATION
  ? ''
  : fs.mkdtempSync(path.join(os.tmpdir(), 'raid-ledger-backup-test-'));
if (!SKIP_BACKUP_INTEGRATION) {
  process.env.BACKUP_DIR = TEST_BACKUP_DIR;
}

function describeBackupCRUD() {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    // Clean up test backup files
    const dailyDir = path.join(TEST_BACKUP_DIR, 'daily');
    const migrationDir = path.join(TEST_BACKUP_DIR, 'migrations');
    for (const dir of [dailyDir, migrationDir]) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.dump')) {
            fs.unlinkSync(path.join(dir, file));
          }
        }
      } catch {
        // Directory may not exist
      }
    }

    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterAll(() => {
    // Remove the temp directory entirely
    fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  });

  describe('POST /admin/backups (create)', () => {
    it('should create a backup file and return its metadata', async () => {
      const res = await testApp.request
        .post('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.backup).toMatchObject({
        filename: expect.stringMatching(/^raid_ledger_.*\.dump$/),
        type: 'daily',
        sizeBytes: expect.any(Number),
        createdAt: expect.any(String),
      });
      expect(res.body.backup.sizeBytes).toBeGreaterThan(0);

      // Verify the file actually exists on disk
      const filepath = path.join(
        TEST_BACKUP_DIR,
        'daily',
        res.body.backup.filename,
      );
      expect(fs.existsSync(filepath)).toBe(true);
    });
  });

  describe('GET /admin/backups (list)', () => {
    it('should return empty list when no backups exist', async () => {
      const res = await testApp.request
        .get('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.backups).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('should list created backups', async () => {
      // Create a backup first
      await testApp.request
        .post('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await testApp.request
        .get('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.backups[0]).toMatchObject({
        filename: expect.stringMatching(/\.dump$/),
        type: 'daily',
        sizeBytes: expect.any(Number),
      });
    });
  });

  function describeDELETEAdminBackupsTypeFilename() {
    it('should delete an existing backup', async () => {
      // Create a backup
      const createRes = await testApp.request
        .post('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);
      const filename = createRes.body.backup.filename as string;

      // Delete it
      const deleteRes = await testApp.request
        .delete(`/admin/backups/daily/${filename}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify it's gone from the list
      const listRes = await testApp.request
        .get('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.body.total).toBe(0);

      // Verify it's gone from disk
      const filepath = path.join(TEST_BACKUP_DIR, 'daily', filename);
      expect(fs.existsSync(filepath)).toBe(false);
    });

    it('should return 404 for non-existent backup', async () => {
      const res = await testApp.request
        .delete('/admin/backups/daily/nonexistent.dump')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 (no leak) on path traversal', async () => {
      const res = await testApp.request
        .delete('/admin/backups/daily/..%2F..%2Fetc%2Fpasswd')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  }
  describe('DELETE /admin/backups/:type/:filename', () =>
    describeDELETEAdminBackupsTypeFilename());

  function describePOSTAdminBackupsTypeFilenameRestore() {
    it('should restore non-sanitized table data from a backup (round-trip)', async () => {
      // app_settings is permanently sanitized (ROK-1279), so the round-trip
      // is verified against `games` (a non-sanitized table).
      // 1. Insert an identifying row
      await testApp.db.insert(schema.games).values({
        name: 'pre-backup-name',
        slug: 'rok-1279-roundtrip',
      });

      // 2. Create a backup (captures the row above)
      const createRes = await testApp.request
        .post('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);
      const filename = createRes.body.backup.filename as string;

      // 3. Mutate the row
      await testApp.db
        .update(schema.games)
        .set({ name: 'mutated-name' })
        .where(eq(schema.games.slug, 'rok-1279-roundtrip'));
      const midRows = await testApp.db
        .select()
        .from(schema.games)
        .where(eq(schema.games.slug, 'rok-1279-roundtrip'));
      expect(midRows[0]?.name).toBe('mutated-name');

      // 4. Restore from backup
      const restoreRes = await testApp.request
        .post(`/admin/backups/daily/${filename}/restore`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(restoreRes.status).toBe(201);
      expect(restoreRes.body.success).toBe(true);

      // 5. Re-seed local_credentials (sanitization wipes it; prod reseeds via
      //    deploy_dev.sh --reset-password) then re-login.
      await reseedAdminCreds(testApp, testApp.seed);
      adminToken = await loginAsAdmin(testApp.request, testApp.seed);

      // 6. Verify the row reverted to the backed-up value
      const afterRows = await testApp.db
        .select()
        .from(schema.games)
        .where(eq(schema.games.slug, 'rok-1279-roundtrip'));
      expect(afterRows[0]?.name).toBe('pre-backup-name');
    });

    it('should create a pre-restore safety snapshot', async () => {
      // Create and restore a backup
      const createRes = await testApp.request
        .post('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);
      const filename = createRes.body.backup.filename as string;

      await testApp.request
        .post(`/admin/backups/daily/${filename}/restore`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Check that a migration/pre-restore snapshot was created
      const listRes = await testApp.request
        .get('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);

      const migrationBackups = (
        listRes.body.backups as { type: string; filename: string }[]
      ).filter((b) => b.type === 'migration');
      expect(migrationBackups.length).toBeGreaterThanOrEqual(1);
      expect(migrationBackups[0].filename).toMatch(/^pre_restore_/);
    });
  }
  describe('POST /admin/backups/:type/:filename/restore', () =>
    describePOSTAdminBackupsTypeFilenameRestore());
}
describeBackup('Backup CRUD (integration)', () => describeBackupCRUD());

describeBackup('Backup auth enforcement (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  it('should reject unauthenticated requests', async () => {
    const endpoints = [
      () => testApp.request.get('/admin/backups'),
      () => testApp.request.post('/admin/backups'),
      () => testApp.request.delete('/admin/backups/daily/test.dump'),
      () => testApp.request.post('/admin/backups/daily/test.dump/restore'),
    ];

    for (const makeRequest of endpoints) {
      const res = await makeRequest();
      expect(res.status).toBe(401);
    }
  });
});

// ───────────────────────── ROK-1279: Sanitization ─────────────────────────

/**
 * Parse `pg_restore --list <dump>` output and return the table names whose
 * DATA segments are present. Each non-schema data line is formatted as e.g.:
 *   `1234; 0 16834 TABLE DATA public games admin`
 * Only DATA entries are returned — schema entries (`TABLE public games`,
 * `SEQUENCE public games_id_seq`, etc.) are filtered out. This is the
 * inverse check used by the sanitization assertions: a sanitized table
 * should NOT appear here, even though its schema row will.
 */
async function getDataSegmentTables(dumpFile: string): Promise<string[]> {
  const { stdout } = await execFileAsync('pg_restore', ['--list', dumpFile]);
  const tables: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+\S+\s+(\S+)/);
    if (match) tables.push(match[1]);
  }
  return tables;
}

/**
 * Match a `TABLE` (schema-definition) line from `pg_restore --list` output and
 * return the table name. Uses a `(?!DATA\s)` negative lookahead so it does NOT
 * match `TABLE DATA` lines — those are handled by `getDataSegmentTables`.
 * Exported as a pure helper so the regex can be unit-tested without shelling
 * out to `pg_restore`.
 */
function parseSchemaTableLine(line: string): string | null {
  const match = line.match(
    /^\s*\d+;\s+\d+\s+\d+\s+TABLE\s+(?!DATA\s)\S+\s+(\S+)/,
  );
  return match ? match[1] : null;
}

/**
 * Parse `pg_restore --list <dump>` and return the table names whose schema
 * definition is present. Sanitization preserves schema, so the four locked
 * tables MUST still appear here even though their DATA segments are gone.
 */
async function getSchemaTables(dumpFile: string): Promise<string[]> {
  const { stdout } = await execFileAsync('pg_restore', ['--list', dumpFile]);
  const tables: string[] = [];
  for (const line of stdout.split('\n')) {
    const name = parseSchemaTableLine(line);
    if (name !== null) tables.push(name);
  }
  return tables;
}

// Pure-helper unit test — runs unconditionally (not gated on pg_dump
// availability) because it never shells out. Locks in the negative case
// the integration assertions don't exercise: a `TABLE DATA` line for a
// sanitized table must NOT register as a surviving schema entry, else
// the sanitization assertions become silently meaningless.
describe('parseSchemaTableLine (ROK-1289)', () => {
  it('matches TABLE schema lines and captures the table name', () => {
    expect(parseSchemaTableLine('1234; 0 16834 TABLE public games admin')).toBe(
      'games',
    );
  });

  it('does NOT match TABLE DATA lines', () => {
    expect(
      parseSchemaTableLine('1234; 0 16834 TABLE DATA public games admin'),
    ).toBeNull();
  });

  it('does NOT match unrelated entry kinds', () => {
    expect(
      parseSchemaTableLine('5678; 0 16900 SEQUENCE public games_id_seq admin'),
    ).toBeNull();
  });
});

describeBackup('Backup sanitization (integration, ROK-1279)', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    // describeBackupCRUD's afterAll wipes TEST_BACKUP_DIR; recreate the
    // dirs here so BackupService can write into them.
    fs.mkdirSync(path.join(TEST_BACKUP_DIR, 'daily'), { recursive: true });
    fs.mkdirSync(path.join(TEST_BACKUP_DIR, 'migrations'), { recursive: true });
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    for (const subdir of ['daily', 'migrations']) {
      const dir = path.join(TEST_BACKUP_DIR, subdir);
      try {
        for (const file of fs.readdirSync(dir)) {
          if (file.endsWith('.dump')) fs.unlinkSync(path.join(dir, file));
        }
      } catch {
        /* directory may not exist */
      }
    }
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  it('createDailyBackup excludes data for the 4 sanitized tables (pg_restore --list)', async () => {
    const createRes = await testApp.request
      .post('/admin/backups')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(createRes.status).toBe(201);
    const filename = createRes.body.backup.filename as string;
    const filepath = path.join(TEST_BACKUP_DIR, 'daily', filename);

    const dataTables = await getDataSegmentTables(filepath);
    for (const t of SANITIZED_EXCLUDED_TABLES) {
      expect(dataTables).not.toContain(t);
    }
    // Sanity: schema is still preserved for those tables.
    const schemaTables = await getSchemaTables(filepath);
    for (const t of SANITIZED_EXCLUDED_TABLES) {
      expect(schemaTables).toContain(t);
    }
  });

  it('createDailyBackup keeps non-excluded table data (e.g. games)', async () => {
    const createRes = await testApp.request
      .post('/admin/backups')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(createRes.status).toBe(201);
    const filename = createRes.body.backup.filename as string;
    const filepath = path.join(TEST_BACKUP_DIR, 'daily', filename);

    const dataTables = await getDataSegmentTables(filepath);
    // The seeded `games` row means this table should ship with data.
    expect(dataTables).toContain('games');
  });

  it('restored dump has 0 rows in the 4 sanitized tables, > 0 in games', async () => {
    // Seed: admin user exists (with local_credentials) + an active session
    // would normally exist, but the truncate + re-seed in beforeEach already
    // gave us a fresh local_credentials row. Take a backup and restore into
    // the SAME DB (test DB is sacrificial across the integration run).
    const createRes = await testApp.request
      .post('/admin/backups')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(createRes.status).toBe(201);
    const filename = createRes.body.backup.filename as string;

    // Restore via the existing endpoint to make data match the dump.
    const restoreRes = await testApp.request
      .post(`/admin/backups/daily/${filename}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(restoreRes.status).toBe(201);

    // No re-login here: sanitization wiped local_credentials, and the
    // assertions below query testApp.db directly (no HTTP auth needed).
    for (const table of SANITIZED_EXCLUDED_TABLES) {
      const rows = await testApp.db.execute<{ count: string }>(
        sql.raw(`SELECT COUNT(*)::text AS count FROM "${table}"`),
      );
      expect(Number(rows[0]?.count ?? '-1')).toBe(0);
    }
    const gamesCount = await testApp.db.execute<{ count: string }>(
      sql.raw(`SELECT COUNT(*)::text AS count FROM "games"`),
    );
    expect(Number(gamesCount[0]?.count ?? '-1')).toBeGreaterThan(0);
  });

  it('createMigrationSnapshot also excludes data for the 4 sanitized tables', async () => {
    // No public endpoint creates a migration snapshot directly, so reach in.
    const svc = testApp.app.get(BackupService);
    const filepath = await svc.createMigrationSnapshot('test-label');

    const dataTables = await getDataSegmentTables(filepath);
    for (const t of SANITIZED_EXCLUDED_TABLES) {
      expect(dataTables).not.toContain(t);
    }
    const schemaTables = await getSchemaTables(filepath);
    for (const t of SANITIZED_EXCLUDED_TABLES) {
      expect(schemaTables).toContain(t);
    }
  });
});

// ─────────────── ROK-1279: GET /admin/backups/:type/:filename/download ───────────────

/** Build a non-admin user JWT by reaching into the running app's JwtService. */
async function signMemberToken(testApp: TestApp): Promise<string> {
  const [member] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: 'local:member@test.local',
      username: 'member-user',
      role: 'member',
    })
    .returning();
  const jwtService = testApp.app.get(JwtService);
  return jwtService.sign({ sub: member.id, username: member.username });
}

/** Write a tiny fixture dump file directly to disk for download tests. */
function seedFixtureDump(filename: string, contents: Buffer): string {
  const dailyDir = path.join(TEST_BACKUP_DIR, 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });
  const filepath = path.join(dailyDir, filename);
  fs.writeFileSync(filepath, contents);
  return filepath;
}

describeBackup(
  'GET /admin/backups/:type/:filename/download (integration, ROK-1279)',
  () => {
    let testApp: TestApp;
    let adminToken: string;
    const fixtureBytes = Buffer.from(
      'PGDMP\x00fake-dump-payload\x00ROK-1279',
      'binary',
    );
    const fixtureName = 'test-fixture.dump';

    beforeAll(async () => {
      // describeBackupCRUD's afterAll wipes TEST_BACKUP_DIR; recreate dirs.
      fs.mkdirSync(path.join(TEST_BACKUP_DIR, 'daily'), { recursive: true });
      fs.mkdirSync(path.join(TEST_BACKUP_DIR, 'migrations'), {
        recursive: true,
      });
      testApp = await getTestApp();
      adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    });

    afterEach(async () => {
      for (const subdir of ['daily', 'migrations']) {
        const dir = path.join(TEST_BACKUP_DIR, subdir);
        try {
          for (const file of fs.readdirSync(dir)) {
            if (file.endsWith('.dump')) fs.unlinkSync(path.join(dir, file));
          }
        } catch {
          /* directory may not exist */
        }
      }
      testApp.seed = await truncateAllTables(testApp.db);
      adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    });

    it('returns 200 + correct headers + exact file bytes for admin', async () => {
      seedFixtureDump(fixtureName, fixtureBytes);

      const res = await testApp.request
        .get(`/admin/backups/daily/${fixtureName}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="${fixtureName}"`,
      );
      expect(Buffer.compare(res.body as Buffer, fixtureBytes)).toBe(0);
    });

    it('returns 401 without an Authorization header', async () => {
      seedFixtureDump(fixtureName, fixtureBytes);
      const res = await testApp.request.get(
        `/admin/backups/daily/${fixtureName}/download`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin user', async () => {
      seedFixtureDump(fixtureName, fixtureBytes);
      const memberToken = await signMemberToken(testApp);
      const res = await testApp.request
        .get(`/admin/backups/daily/${fixtureName}/download`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid type', async () => {
      const res = await testApp.request
        .get(`/admin/backups/evil/${fixtureName}/download`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown filename', async () => {
      const res = await testApp.request
        .get('/admin/backups/daily/does-not-exist.dump/download')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it.each([
      ['url-encoded ../../etc/passwd', '..%2F..%2Fetc%2Fpasswd'],
      ['parent-dir traversal', '../sessions.ts'],
      ['absolute path', '%2Fetc%2Fpasswd'],
    ])('returns 404 (no leak) on path traversal: %s', async (_label, name) => {
      // Plant a sentinel OUTSIDE the backup dir; if the endpoint ever streams
      // it, body bytes will match the sentinel.
      const sentinel = Buffer.from('SENTINEL-DO-NOT-LEAK', 'utf8');
      const escapeTarget = path.join(os.tmpdir(), 'sessions.ts');
      fs.writeFileSync(escapeTarget, sentinel);
      try {
        const res = await testApp.request
          .get(`/admin/backups/daily/${name}/download`)
          .set('Authorization', `Bearer ${adminToken}`)
          .buffer(true)
          .parse((response, callback) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => callback(null, Buffer.concat(chunks)));
          });
        expect(res.status).toBe(404);
        // Belt + suspenders: response body must not contain the sentinel.
        const body =
          res.body instanceof Buffer ? res.body : Buffer.from(String(res.body));
        expect(body.includes(sentinel)).toBe(false);
      } finally {
        fs.unlinkSync(escapeTarget);
      }
    });
  },
);
