/**
 * ROK-1809 — refresh rotation vs revocation race (integration, real Postgres).
 *
 * Interleaving under test: a refresh consumes its parent, a logout /
 * password-change revocation lands, and only THEN does the refresh insert its
 * child. Before ROK-1809 the revoke's UPDATE could not see the not-yet-
 * inserted child, so the child stayed live and kept the session alive.
 *
 * The hook sits between consume and insert: `mintChild` reads the session
 * length (`SettingsService.get(SESSION_LENGTH_DAYS)`) before it inserts. The
 * hook fires the revoke and continues as soon as the revoke has either
 * SETTLED (no lock — the pre-fix behaviour, which then leaves the child live)
 * or is WAITING on the family advisory lock (the fix — it then revokes the
 * child once the rotation commits). Either way the test is deterministic.
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
import { SETTING_KEYS } from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import {
  RefreshTokenService,
  type IssuedRefreshToken,
} from './refresh-token.service';
import { REFRESH_COOKIE_NAME } from './refresh-cookie.helpers';
import { hashToken } from './refresh-token.helpers';
import { REFRESH_FAMILY_LOCK_CLASS } from './refresh-rotation.helpers';
import * as grace from './refresh-grace.helpers';

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

/** Is any session waiting (not granted) on a refresh-family lock? */
async function familyLockWaiterExists(): Promise<boolean> {
  const rows = await testApp.db.execute<{ waiting: number }>(sql`
    SELECT count(*)::int AS waiting FROM pg_locks
    WHERE locktype = 'advisory' AND objsubid = 2 AND NOT granted
      AND classid::text = ${String(REFRESH_FAMILY_LOCK_CLASS)}
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
    if (settled || (await familyLockWaiterExists())) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('revoke neither settled nor waited on the family lock');
}

/**
 * Fire `revoke` (not awaited) between the rotation's consume and its child
 * insert. Returns the revoke promise once the hook has run.
 */
function revokeBetweenConsumeAndMint(revoke: () => Promise<void>) {
  const settings = testApp.app.get(SettingsService);
  const original = settings.get.bind(settings);
  let fired: Promise<void> | undefined;
  jest.spyOn(settings, 'get').mockImplementation(async (key) => {
    if (key === SETTING_KEYS.SESSION_LENGTH_DAYS && fired === undefined) {
      fired = revoke();
      await settledOrBlocked(fired);
    }
    return original(key);
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
