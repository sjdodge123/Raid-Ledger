/**
 * ROK-2263 L3 (MANDATORY) — the scope of an `rlbx_` export token against the
 * real app: it reaches exactly list / create / download and is 401 on every
 * other backup route, on token management, on a non-backup admin route and
 * on the current-user route. Revoked / expired / demoted-owner tokens are 401
 * on the three allowed routes. An admin JWT still reaches all six routes.
 *
 * restore and reset-instance are stubbed on the service (their real effect is
 * backup.integration.spec's job and reset would drop the shared DB); the stub
 * also proves a refused token never reached the handler.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { MintBackupExportTokenResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { BackupService } from '../backup.service';

process.env.DB_CONTAINER_NAME = '';
const PREV_BACKUP_DIR = process.env.BACKUP_DIR;
const PREV_UPLOADS_DIR = process.env.BACKUP_UPLOADS_DIR;
const TEST_BACKUP_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'raid-ledger-backup-scope-'),
);
process.env.BACKUP_DIR = TEST_BACKUP_DIR;
process.env.BACKUP_UPLOADS_DIR = path.join(TEST_BACKUP_DIR, 'no-uploads');

const FILE = 'raid_ledger_2026-01-01_000000.dump';
const FILE_BODY = 'not-a-real-dump-ROK-2263';
const FILE_PATH = path.join(TEST_BACKUP_DIR, 'daily', FILE);

type Verb = 'get' | 'post' | 'delete';
type Route = [Verb, string];

const LIST: Route = ['get', '/admin/backups'];
const CREATE: Route = ['post', '/admin/backups'];
const DOWNLOAD: Route = ['get', `/admin/backups/daily/${FILE}/download`];
const ALLOWED: Route[] = [LIST, CREATE, DOWNLOAD];
const DESTRUCTIVE: Route[] = [
  ['delete', `/admin/backups/daily/${FILE}`],
  ['post', `/admin/backups/daily/${FILE}/restore`],
  ['post', '/admin/backups/reset-instance'],
];
const REJECTED: Route[] = [
  ...DESTRUCTIVE,
  ['get', '/admin/backup-export-tokens'],
  ['post', '/admin/backup-export-tokens'],
  ['get', '/admin/settings/timezone'],
  ['get', '/auth/me'],
];

let testApp: TestApp;
let adminJwt: string;
let service: BackupService;

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(BackupService);
});

beforeEach(async () => {
  adminJwt = await loginAsAdmin(testApp.request, testApp.seed);
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, FILE_BODY);
  jest.spyOn(service, 'restoreFromBackup').mockResolvedValue(undefined);
  jest
    .spyOn(service, 'resetInstance')
    .mockResolvedValue({ password: 'stub-not-a-secret' });
});

afterEach(async () => {
  jest.restoreAllMocks();
  fs.rmSync(path.join(TEST_BACKUP_DIR, 'daily'), {
    recursive: true,
    force: true,
  });
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => {
  fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  restoreEnv('BACKUP_DIR', PREV_BACKUP_DIR);
  restoreEnv('BACKUP_UPLOADS_DIR', PREV_UPLOADS_DIR);
});

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
}

function call([verb, url]: Route, bearer: string) {
  const req = testApp.request[verb](url).set(
    'Authorization',
    `Bearer ${bearer}`,
  );
  return url === '/admin/backup-export-tokens' && verb === 'post'
    ? req.send({ label: 'smuggled' })
    : req;
}

/** Mint a real token through the management API (admin session). */
async function mintToken(): Promise<{ token: string; id: number }> {
  const res = await testApp.request
    .post('/admin/backup-export-tokens')
    .set('Authorization', `Bearer ${adminJwt}`)
    .send({ label: 'scope-spec' });
  expect(res.status).toBe(201);
  const body = MintBackupExportTokenResponseSchema.parse(res.body);
  return { token: body.token, id: body.item.id };
}

function expectDestructiveUntouched(): void {
  expect(fs.readFileSync(FILE_PATH, 'utf8')).toBe(FILE_BODY);
  expect(service.restoreFromBackup).not.toHaveBeenCalled();
  expect(service.resetInstance).not.toHaveBeenCalled();
}

describe('a live export token', () => {
  it('reaches list, create and download (2xx) and stamps last-used', async () => {
    const { token, id } = await mintToken();
    const list = await call(LIST, token);
    expect(list.status).toBe(200);
    expect(list.body.backups).toEqual(
      expect.arrayContaining([expect.objectContaining({ filename: FILE })]),
    );
    const created = await call(CREATE, token);
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    const dl = await call(DOWNLOAD, token).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toBe(
      `attachment; filename="${FILE}"`,
    );
    expect(Buffer.from(dl.body as Buffer).toString('utf8')).toBe(FILE_BODY);
    const [row] = await testApp.db
      .select()
      .from(schema.backupExportTokens)
      .where(eq(schema.backupExportTokens.id, id));
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it.each(REJECTED)(
    'is 401 on %s %s (handler never runs)',
    async (verb, url) => {
      const { token } = await mintToken();
      const res = await call([verb, url], token);
      expect(res.status).toBe(401);
      expectDestructiveUntouched();
    },
  );
});

describe('a dead export token is 401 on the three allowed routes', () => {
  async function expectDead(token: string): Promise<void> {
    for (const route of ALLOWED) {
      const res = await call(route, token);
      expect({ route: route.join(' '), status: res.status }).toEqual({
        route: route.join(' '),
        status: 401,
      });
    }
  }

  it('revoked', async () => {
    const { token, id } = await mintToken();
    const res = await testApp.request
      .delete(`/admin/backup-export-tokens/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(204);
    await expectDead(token);
  });

  it('expired', async () => {
    const { token, id } = await mintToken();
    await testApp.db
      .update(schema.backupExportTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.backupExportTokens.id, id));
    await expectDead(token);
  });

  it('owner demoted to member', async () => {
    const { token } = await mintToken();
    await testApp.db
      .update(schema.users)
      .set({ role: 'member' })
      .where(eq(schema.users.id, testApp.seed.adminUser.id));
    await expectDead(token);
  });

  it('owner banned', async () => {
    const { token } = await mintToken();
    await testApp.db
      .update(schema.users)
      .set({ bannedAt: new Date() })
      .where(eq(schema.users.id, testApp.seed.adminUser.id));
    await expectDead(token);
  });

  it('owner deactivated', async () => {
    const { token } = await mintToken();
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, testApp.seed.adminUser.id));
    await expectDead(token);
  });
});

describe('an admin JWT (regression)', () => {
  it('reaches the non-backup admin route the token is refused on (200)', async () => {
    const res = await call(['get', '/admin/settings/timezone'], adminJwt);
    expect(res.status).toBe(200);
  });

  it('still reaches all six backup routes', async () => {
    const statuses: Record<string, number> = {};
    for (const route of [...ALLOWED, ...DESTRUCTIVE]) {
      statuses[route.join(' ')] = (await call(route, adminJwt)).status;
    }
    expect(statuses).toEqual({
      'get /admin/backups': 200,
      'post /admin/backups': 201,
      [`get /admin/backups/daily/${FILE}/download`]: 200,
      [`delete /admin/backups/daily/${FILE}`]: 200,
      [`post /admin/backups/daily/${FILE}/restore`]: 201,
      'post /admin/backups/reset-instance': 201,
    });
    expect(service.restoreFromBackup).toHaveBeenCalledWith('daily', FILE);
    expect(service.resetInstance).toHaveBeenCalledTimes(1);
  });
});
