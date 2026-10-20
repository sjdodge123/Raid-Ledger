/**
 * ROK-1809 — refresh rotation vs revocation race (integration, real Postgres).
 *
 * Interleaving under test: a refresh consumes its parent, a logout /
 * password-change revocation lands, and only THEN does the refresh insert its
 * child. Before ROK-1809 the revoke's UPDATE could not see the not-yet-
 * inserted child, so the child stayed live and kept the session alive.
 *
 * The hook wraps `consumeRow` (inside rotate's transaction, after the
 * family lock): once the parent is consumed it fires the revoke WITHOUT
 * awaiting it and continues as soon as the revoke has either SETTLED (no
 * lock and no transaction — the pre-fix behaviour, which then leaves the
 * child live) or is WAITING on a lock (the family advisory lock — the fix,
 * which then revokes the child once the rotation commits — or the consumed
 * parent's row lock, the transaction-without-family-lock mutant, whose
 * UPDATE snapshot then misses the child). Either way it is deterministic.
 * Codex r3: the hook used to sit on the settings read, which now runs
 * before the transaction, so the revoke landed before the consume.
 *
 * Without the fix the child-revoked assertions fail with
 * `Expected: {"childRevoked": true} / Received: {"childRevoked": false}`,
 * and the sibling test fails with `Expected: null / Received: {rawToken…}`.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { defined } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  RefreshTokenService,
  type IssuedRefreshToken,
} from './refresh-token.service';
import { REFRESH_COOKIE_NAME } from './refresh-cookie.helpers';
import { hashToken } from './refresh-token.helpers';
import * as rotation from './refresh-rotation.helpers';
import * as grace from './refresh-grace.helpers';
import { PasswordChangeSessionService } from '../password-change/password-change-session.service';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

function service(): RefreshTokenService {
  return testApp.app.get(RefreshTokenService);
}

async function revokedAtOf(rawToken: string): Promise<Date | null> {
  const [row] = await testApp.db
    .select({ revokedAt: schema.refreshTokens.revokedAt })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hashToken(rawToken)))
    .limit(1);
  return defined(row, 'refresh row for token').revokedAt;
}

/**
 * Is any session waiting (not granted) on a refresh-family advisory lock or
 * on another transaction (a row lock held by the uncommitted consume)?
 */
async function lockWaiterExists(): Promise<boolean> {
  const rows = await testApp.db.execute<{ waiting: number }>(sql`
    SELECT count(*)::int AS waiting FROM pg_locks
    WHERE NOT granted AND (
      locktype = 'transactionid' OR (
        locktype = 'advisory' AND objsubid = 2
        AND classid::text = ${String(rotation.REFRESH_FAMILY_LOCK_CLASS)}
      )
    )
  `);
  return defined(rows[0], 'pg_locks count row').waiting > 0;
}

/** Resolve once the revoke settles OR blocks on the family lock (≤5 s). */
async function settledOrBlocked(revoke: Promise<void>): Promise<void> {
  let settled = false;
  void revoke.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 200; i++) {
    if (settled || (await lockWaiterExists())) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('revoke neither settled nor waited on a lock');
}

/**
 * Fire `revoke` (not awaited) right after rotate's consume, inside its
 * transaction and under the family lock, before the child insert. Returns
 * the revoke promise once the hook has run.
 */
function revokeBetweenConsumeAndMint(revoke: () => Promise<void>) {
  const original = rotation.consumeRow;
  let fired: Promise<void> | undefined;
  jest.spyOn(rotation, 'consumeRow').mockImplementation(async (tx, hash) => {
    const consumed = await original(tx, hash);
    if (consumed !== undefined && fired === undefined) {
      fired = revoke();
      await settledOrBlocked(fired);
    }
    return consumed;
  });
  return (): Promise<void> => defined(fired, 'revoke hook fired');
}

/** Rotate and fail loudly when no token comes back. */
async function rotateOrFail(rawToken: string): Promise<IssuedRefreshToken> {
  const rotated = await service().rotate(rawToken);
  if (rotated === null) throw new Error('rotate() returned null (401)');
  return rotated;
}

async function issueAdminFamily() {
  const userId = testApp.seed.adminUser.id;
  const issued = await service().issue(userId, { authMethod: 'local' });
  return { userId, issued };
}

describe('ROK-1809 refresh rotation vs revocation', () => {
  it('a family revoked mid-rotation also revokes the minted child', async () => {
    const { issued } = await issueAdminFamily();
    const revokeDone = revokeBetweenConsumeAndMint(() =>
      service().revokeFamily(issued.familyId, 'logout'),
    );

    const child = await rotateOrFail(issued.rawToken);
    await revokeDone();

    const childRevoked = (await revokedAtOf(child.rawToken)) !== null;
    expect({ childRevoked }).toEqual({ childRevoked: true });
    const refresh = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${child.rawToken}`);
    expect(refresh.status).toBe(401);
  });

  it('revokeAllForUser mid-rotation also revokes the minted child', async () => {
    const { userId, issued } = await issueAdminFamily();
    const revokeDone = revokeBetweenConsumeAndMint(() =>
      service().revokeAllForUser(userId),
    );

    const child = await rotateOrFail(issued.rawToken);
    await revokeDone();

    const childRevoked = (await revokedAtOf(child.rawToken)) !== null;
    expect({ childRevoked }).toEqual({ childRevoked: true });
    await expect(service().rotate(child.rawToken)).resolves.toBeNull();
  });

  it('a grace replay revoked before its sibling mint gets no sibling', async () => {
    const { issued } = await issueAdminFamily();
    await rotateOrFail(issued.rawToken);
    const originalClaim = grace.claimGraceOnce;
    jest
      .spyOn(grace, 'claimGraceOnce')
      .mockImplementationOnce(async (redis, parentId) => {
        await service().revokeFamily(issued.familyId, 'logout');
        return originalClaim(redis, parentId);
      });

    const sibling = await service().rotate(issued.rawToken);

    expect(sibling).toBeNull();
  });
});

// ── ROK-1820: a refresh committed before a password change, answered after ──

function refreshWith(rawToken: string) {
  return testApp.request
    .post('/auth/refresh')
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** The `rl_rt` value a response sets, or undefined when it sets none. */
function refreshCookieSet(res: {
  headers: Record<string, unknown>;
}): string | undefined {
  const raw = res.headers['set-cookie'];
  const lines = isStringArray(raw) ? raw : [];
  const prefix = `${REFRESH_COOKIE_NAME}=`;
  const line = lines.find((l) => l.startsWith(prefix));
  return line?.slice(prefix.length).split(';')[0];
}

/**
 * Run `between` right after the controller's `rotate()` commits the child and
 * before the access token is minted — the window where another device's
 * password change lands while this refresh is still in flight.
 */
function afterRotateCommits(between: () => Promise<unknown>): void {
  const svc = service();
  const original = svc.rotate.bind(svc);
  jest.spyOn(svc, 'rotate').mockImplementationOnce(async (raw) => {
    const rotated = await original(raw);
    await between();
    return rotated;
  });
}

describe('ROK-1820 refresh in flight across a password change', () => {
  it('revoke committed but block not yet written → 401 and no rl_rt Set-Cookie', async () => {
    const { userId, issued } = await issueAdminFamily();
    // revokeAllSessions step 1 only: the blocklist write has not landed yet.
    afterRotateCommits(() => service().revokeAllForUser(userId));

    const res = await refreshWith(issued.rawToken);

    expect({ status: res.status, cookie: refreshCookieSet(res) }).toEqual({
      status: 401,
      cookie: undefined,
    });
  });

  it('a full password change mid-refresh → 401, no rl_rt, and the re-issued token still rotates', async () => {
    const { userId, issued } = await issueAdminFamily();
    const pw = testApp.app.get(PasswordChangeSessionService);
    const admin = testApp.seed.adminUser;
    let reissued: string | undefined;
    afterRotateCommits(async () => {
      const tokenVersion = await pw.revokeAllSessions(userId);
      const session = await pw.issueSession(
        { id: admin.id, username: admin.username, role: admin.role },
        null,
        tokenVersion,
      );
      reissued = session.refresh.rawToken;
    });

    const stale = await refreshWith(issued.rawToken);
    expect({ status: stale.status, cookie: refreshCookieSet(stale) }).toEqual({
      status: 401,
      cookie: undefined,
    });

    // Same second as the block: the password change's own token is not caught.
    const fresh = await refreshWith(defined(reissued, 're-issued rl_rt'));
    expect(fresh.status).toBe(200);
    expect(refreshCookieSet(fresh)).toEqual(expect.any(String));
  });
});
