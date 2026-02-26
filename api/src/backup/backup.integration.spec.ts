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
} from '../common/testing/integration-helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Force direct pg_dump/pg_restore execution (no Docker routing)
// so it works with the Testcontainers DB.
process.env.DB_CONTAINER_NAME = '';

// Isolate test backups in a temp directory so we never touch real backup files.
const TEST_BACKUP_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'raid-ledger-backup-test-'),
);
process.env.BACKUP_DIR = TEST_BACKUP_DIR;

describe('Backup CRUD (integration)', () => {
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

  describe('DELETE /admin/backups/:type/:filename', () => {
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

    it('should reject path traversal', async () => {
      const res = await testApp.request
        .delete('/admin/backups/daily/..%2F..%2Fetc%2Fpasswd')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /admin/backups/:type/:filename/restore', () => {
    it('should restore data from a backup', async () => {
      // 1. Create some identifiable data
      await testApp.request
        .put('/admin/settings/timezone')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ timezone: 'America/New_York' });

      // 2. Create a backup (captures the timezone setting)
      const createRes = await testApp.request
        .post('/admin/backups')
        .set('Authorization', `Bearer ${adminToken}`);
      const filename = createRes.body.backup.filename as string;

      // 3. Change the data (overwrite timezone)
      await testApp.request
        .put('/admin/settings/timezone')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ timezone: 'Europe/London' });

      // Verify it changed
      const midRes = await testApp.request
        .get('/admin/settings/timezone')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(midRes.body.timezone).toBe('Europe/London');

      // 4. Restore from backup
      const restoreRes = await testApp.request
        .post(`/admin/backups/daily/${filename}/restore`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(restoreRes.status).toBe(201);
      expect(restoreRes.body.success).toBe(true);

      // 5. Re-login (restore may have changed session state)
      adminToken = await loginAsAdmin(testApp.request, testApp.seed);

      // 6. Verify the timezone reverted to the backup value
      const afterRes = await testApp.request
        .get('/admin/settings/timezone')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(afterRes.body.timezone).toBe('America/New_York');
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

      const migrationBackups = listRes.body.backups.filter(
        (b: { type: string }) => b.type === 'migration',
      );
      expect(migrationBackups.length).toBeGreaterThanOrEqual(1);
      expect(migrationBackups[0].filename).toMatch(/^pre_restore_/);
    });
  });
});

describe('Backup auth enforcement (integration)', () => {
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
