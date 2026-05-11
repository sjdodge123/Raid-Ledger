/**
 * ROK-1260 — Profile-visibility integration tests for UsersController.
 *
 * Operator decision: when a user is deactivated (`deactivated_at IS NOT
 * NULL`), all PUBLIC profile + sub-resource endpoints MUST 404 for
 * non-admin viewers (and for unauthenticated requests). Admins still see
 * everything — they need full visibility to audit and reactivate.
 *
 * The 7 endpoints under test:
 *   - GET /users/:id/profile
 *   - GET /users/:id/characters
 *   - GET /users/:id/hearted-games
 *   - GET /users/:id/steam-library
 *   - GET /users/:id/steam-wishlist
 *   - GET /users/:id/activity
 *   - GET /users/:id/events/signups
 *
 * These tests FAIL today because
 *   1. The `deactivated_at` column does not exist yet (raw SQL UPDATE
 *      below will throw `column "deactivated_at" does not exist`), and
 *   2. The controller has no `assertUserVisible(...)` gate, so each
 *      endpoint still returns 200 for deactivated users regardless of
 *      viewer role, and
 *   3. Five of the seven endpoints lack `@UseGuards(OptionalJwtGuard)`,
 *      so `req.user` is `undefined` and the admin bypass cannot read the
 *      viewer role anyway.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

let testApp: TestApp;
let adminToken: string;

async function setupAll(): Promise<void> {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

async function resetAfterEach(): Promise<void> {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

// ── Constants ───────────────────────────────────────────────────────────────

interface EndpointDef {
  /** Friendly name for `describe`/`it` labels. */
  name: string;
  /** Path builder — receives the target user id. */
  build(targetId: number): string;
}

const PROTECTED_ENDPOINTS: ReadonlyArray<EndpointDef> = [
  {
    name: 'GET /users/:id/profile',
    build: (id) => `/users/${id}/profile`,
  },
  {
    name: 'GET /users/:id/characters',
    build: (id) => `/users/${id}/characters`,
  },
  {
    name: 'GET /users/:id/hearted-games',
    build: (id) => `/users/${id}/hearted-games`,
  },
  {
    name: 'GET /users/:id/steam-library',
    build: (id) => `/users/${id}/steam-library`,
  },
  {
    name: 'GET /users/:id/steam-wishlist',
    build: (id) => `/users/${id}/steam-wishlist`,
  },
  {
    name: 'GET /users/:id/activity',
    build: (id) => `/users/${id}/activity`,
  },
  {
    name: 'GET /users/:id/events/signups',
    build: (id) => `/users/${id}/events/signups`,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Mark a user as deactivated via raw SQL — does NOT depend on the
 * `deactivateUser()` service method, so this helper can be used to set
 * up the precondition independently from the unit-tested orchestration.
 */
async function markDeactivated(userId: number): Promise<void> {
  await testApp.db.execute(
    /* sql */ `UPDATE users SET deactivated_at = NOW() WHERE id = ${userId}`,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('UsersController profile visibility — ROK-1260', () => {
  describe.each(PROTECTED_ENDPOINTS)('$name', ({ build }) => {
    it('returns 404 for an UNAUTHENTICATED viewer when target is deactivated', async () => {
      const { userId } = await createMemberAndLogin(
        testApp,
        'deactvis',
        'deactvis@test.local',
      );
      await markDeactivated(userId);

      const res = await testApp.request.get(build(userId));
      expect(res.status).toBe(404);
    });

    it('returns 404 for a NON-ADMIN viewer when target is deactivated', async () => {
      const { userId: targetId } = await createMemberAndLogin(
        testApp,
        'target-deact',
        'target-deact@test.local',
      );
      await markDeactivated(targetId);
      const { token: viewerToken } = await createMemberAndLogin(
        testApp,
        'viewer-member',
        'viewer-member@test.local',
      );

      const res = await testApp.request
        .get(build(targetId))
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(404);
    });

    it('returns 200 for an ADMIN viewer when target is deactivated (audit access)', async () => {
      const { userId: targetId } = await createMemberAndLogin(
        testApp,
        'admin-can-see',
        'admin-can-see@test.local',
      );
      await markDeactivated(targetId);

      const res = await testApp.request
        .get(build(targetId))
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });

    it('returns 200 when the target is ACTIVE, regardless of viewer', async () => {
      const { userId: targetId } = await createMemberAndLogin(
        testApp,
        'active-target',
        'active-target@test.local',
      );

      // Sanity: confirm the user is NOT deactivated.
      const [row] = await testApp.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, targetId))
        .limit(1);
      expect(row).toBeDefined();

      // Unauth — still 200 for active user.
      const anonRes = await testApp.request.get(build(targetId));
      expect(anonRes.status).toBe(200);

      // Non-admin — still 200.
      const { token: viewerToken } = await createMemberAndLogin(
        testApp,
        'viewer-active',
        'viewer-active@test.local',
      );
      const memberRes = await testApp.request
        .get(build(targetId))
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(memberRes.status).toBe(200);

      // Admin — still 200.
      const adminRes = await testApp.request
        .get(build(targetId))
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);
    });
  });
});
