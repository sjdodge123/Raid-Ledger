/**
 * Public lineup HTTP integration tests (ROK-1067).
 *
 * Validates `GET /lineups/public/:slug` plus the create-time refine on
 * `POST /lineups`:
 *   - 200 for an enabled public lineup (and 200 with NO `Authorization`
 *     header — locks in the unguarded contract per architect finding #5)
 *   - 404 when `public_share_enabled = false`
 *   - 404 when `visibility = 'private'`
 *   - Response body has EXACTLY the expected key set; no leakage of
 *     voters / votes / nominees / invitees
 *   - `POST /lineups` with private + publicShareEnabled=true → 400
 *
 * TDD gate (Step 2d): the controller, service, and contract additions
 * do not yet exist on this branch. Every assertion below fails on the
 * unimplemented branch — that is the desired baseline.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';

const EXPECTED_PUBLIC_KEYS = [
  'title',
  'description',
  'status',
  'decision',
  'communityName',
].sort();

const FORBIDDEN_KEYS = [
  'voters',
  'votes',
  'nominees',
  'invitees',
  'voterIds',
  'inviteeUserIds',
  'createdBy',
  'id',
] as const;

interface CreatedLineup {
  id: number;
  publicSlug: string;
  publicShareEnabled: boolean;
  visibility?: 'public' | 'private';
}

function describePublicLineup() {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── Helpers ──────────────────────────────────────────────────

  async function createPublicLineup(
    overrides: Record<string, unknown> = {},
  ): Promise<CreatedLineup> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'ROK-1067 public',
        publicShareEnabled: true,
        ...overrides,
      });
    expect(res.status).toBe(201);
    expect(res.body.publicSlug).toEqual(expect.any(String));
    return {
      id: res.body.id as number,
      publicSlug: res.body.publicSlug as string,
      publicShareEnabled: res.body.publicShareEnabled as boolean,
      visibility: res.body.visibility,
    };
  }

  async function setPublicShare(id: number, enabled: boolean): Promise<void> {
    const res = await testApp.request
      .patch(`/lineups/${id}/public-share`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  }

  // ── 200 path — enabled lineup ───────────────────────────────

  it('returns 200 for an enabled public lineup', async () => {
    const { publicSlug } = await createPublicLineup();

    const res = await testApp.request.get(`/lineups/public/${publicSlug}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.title).toBe('string');
  });

  // ── architect finding #5 — unguarded behavior ───────────────

  it('returns 200 with NO Authorization header (unguarded contract)', async () => {
    const { publicSlug } = await createPublicLineup();

    const res = await testApp.request
      .get(`/lineups/public/${publicSlug}`)
      // intentionally no .set('Authorization')
      .send();

    expect(res.status).toBe(200);
  });

  // ── 404 path — toggle off ───────────────────────────────────

  it('returns 404 when public_share_enabled = false', async () => {
    const { id, publicSlug } = await createPublicLineup();
    await setPublicShare(id, false);

    const res = await testApp.request.get(`/lineups/public/${publicSlug}`);
    expect(res.status).toBe(404);
  });

  // ── 404 path — private lineup (info-hiding) ────────────────

  it('returns 404 when lineup is private (visibility=private)', async () => {
    // Need an invitee so the private-lineup refine passes.
    const bcrypt = await import('bcrypt');
    const schema = await import('../drizzle/schema');
    const passwordHash = await bcrypt.hash('Pass1Pass1!', 4);
    const [invitee] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:priv-invitee@test.local',
        username: 'priv-invitee',
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'priv-invitee@test.local',
      passwordHash,
      userId: invitee.id,
    });

    const createRes = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'ROK-1067 private',
        visibility: 'private',
        publicShareEnabled: false,
        inviteeUserIds: [invitee.id],
      });
    expect(createRes.status).toBe(201);
    const slug = createRes.body.publicSlug as string;
    expect(typeof slug).toBe('string');

    const res = await testApp.request.get(`/lineups/public/${slug}`);
    expect(res.status).toBe(404);
  });

  // ── Field-leak defense — exact key set ─────────────────────

  it('response body has EXACTLY {title, description, status, decision, communityName}', async () => {
    const { publicSlug } = await createPublicLineup();

    const res = await testApp.request.get(`/lineups/public/${publicSlug}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(EXPECTED_PUBLIC_KEYS);
  });

  it('response NEVER contains voters / votes / nominees / invitees / internal ids', async () => {
    const { publicSlug } = await createPublicLineup();

    const res = await testApp.request.get(`/lineups/public/${publicSlug}`);
    expect(res.status).toBe(200);

    for (const key of FORBIDDEN_KEYS) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  // ── Cross-field refine on POST /lineups ────────────────────

  it('rejects POST /lineups with private + publicShareEnabled=true (400)', async () => {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'invalid combo',
        visibility: 'private',
        publicShareEnabled: true,
        inviteeUserIds: [testApp.seed.adminUser.id],
      });

    expect(res.status).toBe(400);
  });
}

describe('Lineups — public share link (integration, ROK-1067)', describePublicLineup);
