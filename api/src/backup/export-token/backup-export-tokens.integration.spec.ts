/**
 * ROK-2263 L2: backup-export token management (`/admin/backup-export-tokens`)
 * against a real DB — plaintext shown once, hash-only storage, live cap,
 * idempotent revoke, admin-only access and the `admin_actions` audit rows.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  BACKUP_EXPORT_TOKEN_LIVE_CAP,
  BACKUP_EXPORT_TOKEN_PATTERN,
  BackupExportTokenListResponseSchema,
  MintBackupExportTokenResponseSchema,
  type MintBackupExportTokenResponse,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import * as adminActionsHelpers from '../../users/users-admin-actions.helpers';

const BASE = '/admin/backup-export-tokens';
const DAY_MS = 24 * 60 * 60 * 1000;

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function mint(body: object): Promise<MintBackupExportTokenResponse> {
  const res = await testApp.request
    .post(BASE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  expect(res.status).toBe(201);
  return MintBackupExportTokenResponseSchema.parse(res.body);
}

async function memberJwt(): Promise<string> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:bx-member',
        username: 'bx-member',
        role: 'member',
      })
      .returning(),
    'member',
  );
  return signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: 'member',
  });
}

function expectDaysAhead(iso: string | null, days: number): void {
  expect(iso).not.toBeNull();
  const delta = new Date(iso ?? 0).getTime() - Date.now();
  expect(Math.abs(delta - days * DAY_MS)).toBeLessThan(60_000);
}

describe('mint', () => {
  it('returns the plaintext once, matching the rlbx_ pattern, never cached', async () => {
    const res = await testApp.request
      .post(BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: '  laptop  ' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = MintBackupExportTokenResponseSchema.parse(res.body);
    expect(body.token).toMatch(BACKUP_EXPORT_TOKEN_PATTERN);
    expect(body.item.label).toBe('laptop');
    expect(body.item.tokenHint).toBe(body.token.slice(-4));
    expect(body.item.createdBy).toEqual({
      id: testApp.seed.adminUser.id,
      username: testApp.seed.adminUser.username,
    });
    expect(body.item.revokedAt).toBeNull();
    expectDaysAhead(body.item.expiresAt, 90);
  });

  it('honours 30 / 365 / never expiry and rejects other values', async () => {
    expectDaysAhead(
      (await mint({ label: 'a', expiresInDays: 30 })).item.expiresAt,
      30,
    );
    expectDaysAhead(
      (await mint({ label: 'b', expiresInDays: 365 })).item.expiresAt,
      365,
    );
    expect(
      (await mint({ label: 'c', expiresInDays: null })).item.expiresAt,
    ).toBeNull();
    for (const body of [
      { label: 'd', expiresInDays: 7 },
      { label: '   ', expiresInDays: 90 },
      { label: 'x'.repeat(61), expiresInDays: 90 },
      { label: 'e', expiresInDays: 90, tokenHash: 'f'.repeat(64) },
    ]) {
      const res = await testApp.request
        .post(BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('stores only the sha256 hash and hint — never the plaintext', async () => {
    const { token, item } = await mint({ label: 'hash-only' });
    const [row] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.backupExportTokens)
        .where(eq(schema.backupExportTokens.id, item.id)),
      'token row',
    );
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHint).toBe(token.slice(-4));
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe('list', () => {
  it('never contains the plaintext token or its hash', async () => {
    const { token, item } = await mint({ label: 'listed' });
    const res = await testApp.request
      .get(BASE)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = BackupExportTokenListResponseSchema.parse(res.body);
    expect(body.tokens.map((t) => t.id)).toEqual([item.id]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(sha256(token));
  });
});

describe('live cap', () => {
  it(`refuses mint #${BACKUP_EXPORT_TOKEN_LIVE_CAP + 1} with 409 until one is revoked`, async () => {
    const minted: number[] = [];
    for (let i = 0; i < BACKUP_EXPORT_TOKEN_LIVE_CAP; i++) {
      minted.push((await mint({ label: `t${i}` })).item.id);
    }
    const over = await testApp.request
      .post(BASE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'one too many' });
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({ code: 'backup_export_token_cap' });
    await testApp.request
      .delete(`${BASE}/${minted[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    await mint({ label: 'after revoke' });
  });

  it('does not count expired tokens', async () => {
    await testApp.db.insert(schema.backupExportTokens).values({
      label: 'expired',
      tokenHash: 'e'.repeat(64),
      tokenHint: 'eeee',
      createdBy: testApp.seed.adminUser.id,
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    for (let i = 0; i < BACKUP_EXPORT_TOKEN_LIVE_CAP; i++) {
      await mint({ label: `live${i}` });
    }
  });

  it('holds under concurrent mints (count + insert are serialised)', async () => {
    const attempts = BACKUP_EXPORT_TOKEN_LIVE_CAP + 3;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        testApp.request
          .post(BASE)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ label: `race${i}` }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(
      BACKUP_EXPORT_TOKEN_LIVE_CAP,
    );
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    const rows = await testApp.db.select().from(schema.backupExportTokens);
    expect(rows).toHaveLength(BACKUP_EXPORT_TOKEN_LIVE_CAP);
  });
});

describe('revoke', () => {
  it('stamps revoked_at once; a second revoke is a 204 no-op; unknown id 404', async () => {
    const { item } = await mint({ label: 'revoke-me' });
    const del = () =>
      testApp.request
        .delete(`${BASE}/${item.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
    expect((await del()).status).toBe(204);
    const read = async () =>
      nonEmpty(
        await testApp.db
          .select()
          .from(schema.backupExportTokens)
          .where(eq(schema.backupExportTokens.id, item.id)),
        'row',
      )[0];
    const first = (await read()).revokedAt;
    expect(first).toBeInstanceOf(Date);
    expect((await del()).status).toBe(204);
    expect((await read()).revokedAt).toEqual(first);
    const missing = await testApp.request
      .delete(`${BASE}/999999`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({
      code: 'backup_export_token_not_found',
    });
  });
});

describe('audit', () => {
  it('writes one mint and one revoke row with tokenId + label, no secret', async () => {
    const { token, item } = await mint({ label: 'audited' });
    for (let i = 0; i < 2; i++) {
      await testApp.request
        .delete(`${BASE}/${item.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    }
    const rows = await testApp.db.select().from(schema.adminActions);
    const ours = rows
      .filter((r) => r.action.startsWith('backup_token_'))
      .map((r) => ({
        action: r.action,
        actorId: r.actorId,
        targetId: r.targetId,
        metadata: r.metadata,
      }));
    const metadata = JSON.stringify({ tokenId: item.id, label: 'audited' });
    const actorId = testApp.seed.adminUser.id;
    expect(ours).toEqual([
      { action: 'backup_token_mint', actorId, targetId: null, metadata },
      { action: 'backup_token_revoke', actorId, targetId: null, metadata },
    ]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe('audit atomicity', () => {
  it('a failing audit write rolls the mint back: no token row survives', async () => {
    const spy = jest
      .spyOn(adminActionsHelpers, 'insertAdminAction')
      .mockRejectedValueOnce(new Error('audit insert failed (stub)'));
    try {
      const res = await testApp.request
        .post(BASE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: 'unaudited' });
      const rows = await testApp.db.select().from(schema.backupExportTokens);
      expect(rows.map((r) => r.label)).toEqual([]);
      expect(res.status).toBe(500);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('a failing audit write rolls the revoke back: the token stays live', async () => {
    const { item } = await mint({ label: 'revoke-unaudited' });
    const spy = jest
      .spyOn(adminActionsHelpers, 'insertAdminAction')
      .mockRejectedValueOnce(new Error('audit insert failed (stub)'));
    try {
      const res = await testApp.request
        .delete(`${BASE}/${item.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const [row] = nonEmpty(
        await testApp.db
          .select()
          .from(schema.backupExportTokens)
          .where(eq(schema.backupExportTokens.id, item.id)),
        'row',
      );
      expect(row?.revokedAt ?? null).toBeNull();
      expect(res.status).toBe(500);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('access', () => {
  it('a member JWT gets 403 and no session gets 401 on every route', async () => {
    const member = await memberJwt();
    const routes = [
      () => testApp.request.get(BASE),
      () => testApp.request.post(BASE).send({ label: 'x' }),
      () => testApp.request.delete(`${BASE}/1`),
    ];
    for (const route of routes) {
      expect(
        (await route().set('Authorization', `Bearer ${member}`)).status,
      ).toBe(403);
      expect((await route()).status).toBe(401);
    }
    expect(await testApp.db.select().from(schema.backupExportTokens)).toEqual(
      [],
    );
  });

  it('an rlbx_ token cannot manage tokens (401 on every route)', async () => {
    const { token, item } = await mint({ label: 'self-manage' });
    const routes = [
      () => testApp.request.get(BASE),
      () => testApp.request.post(BASE).send({ label: 'x' }),
      () => testApp.request.delete(`${BASE}/${item.id}`),
    ];
    for (const route of routes) {
      expect(
        (await route().set('Authorization', `Bearer ${token}`)).status,
      ).toBe(401);
    }
    const rows = await testApp.db.select().from(schema.backupExportTokens);
    expect(rows.map((r) => r.revokedAt)).toEqual([null]);
  });
});
