/**
 * ROK-1063 — feat: lineup title & description
 *
 * Failing TDD integration tests that cover the acceptance criteria for the
 * new `title` + `description` fields on community lineups and the new
 * `PATCH /lineups/:id/metadata` endpoint.
 *
 * These tests intentionally fail against the current codebase — they
 * describe the target behavior for the dev agent to implement.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describeLineupMetadata() {
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

  async function loginAsMember(): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('MemberPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:member@test.local',
        username: 'member',
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'member@test.local',
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'member@test.local', password: 'MemberPass1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createLineup(token: string, body: Record<string, unknown>) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  // ── POST /lineups — title validation ─────────────────────────

  function describeCreateValidation() {
    it('should reject blank title with 400', async () => {
      const res = await createLineup(adminToken, { title: '' });
      expect(res.status).toBe(400);
    });

    it('should reject 101-char title with 400', async () => {
      const res = await createLineup(adminToken, {
        title: 'a'.repeat(101),
      });
      expect(res.status).toBe(400);
    });

    it('should reject >500 char description with 400', async () => {
      const res = await createLineup(adminToken, {
        title: 'Friday Night Raid',
        description: 'd'.repeat(501),
      });
      expect(res.status).toBe(400);
    });

    it('should return 201 with title + description echoed back', async () => {
      const res = await createLineup(adminToken, {
        title: 'Friday Night Raid',
        description: 'Weekly community pick — vote for your favorite!',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        title: 'Friday Night Raid',
        description: 'Weekly community pick — vote for your favorite!',
      });
    });

    it('should accept missing description (optional)', async () => {
      const res = await createLineup(adminToken, {
        title: 'Spring Lineup',
      });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Spring Lineup');
      // Description is optional — null or undefined both acceptable
      expect(res.body.description ?? null).toBeNull();
    });
  }
  describe('POST /lineups — title & description', describeCreateValidation);

  // ── PATCH /lineups/:id/metadata ──────────────────────────────

  function describePatchMetadata() {
    async function createForUpdate() {
      const res = await createLineup(adminToken, {
        title: 'Initial Title',
        description: 'Initial description',
      });
      return res.body.id as number;
    }

    it('should return 200 and updated title/description for admin', async () => {
      const id = await createForUpdate();
      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Renamed Lineup',
          description: 'Updated description',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        title: 'Renamed Lineup',
        description: 'Updated description',
      });
    });

    it('should allow description to be cleared to null', async () => {
      const id = await createForUpdate();
      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Kept Title', description: null });

      expect(res.status).toBe(200);
      expect(res.body.description).toBeNull();
    });

    it('should reject blank title with 400', async () => {
      const id = await createForUpdate();
      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: '' });
      expect(res.status).toBe(400);
    });

    it('should reject 101-char title with 400', async () => {
      const id = await createForUpdate();
      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'z'.repeat(101) });
      expect(res.status).toBe(400);
    });

    it('should reject >500 char description with 400', async () => {
      const id = await createForUpdate();
      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'd'.repeat(501) });
      expect(res.status).toBe(400);
    });

    it('should return 409 when lineup is archived', async () => {
      const id = await createForUpdate();
      // Force lineup to archived state directly — avoids needing entries/games
      await testApp.db
        .update(schema.communityLineups)
        .set({ status: 'archived' })
        .where(eq(schema.communityLineups.id, id));

      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Too Late' });

      expect(res.status).toBe(409);
    });

    it('should return 403 for non-creator member', async () => {
      const id = await createForUpdate();
      const { token: memberToken } = await loginAsMember();

      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'Hijack' });

      expect(res.status).toBe(403);
    });

    it('should return 401 when unauthenticated', async () => {
      const id = await createForUpdate();
      const res = await testApp.request
        .patch(`/lineups/${id}/metadata`)
        .send({ title: 'No auth' });
      expect(res.status).toBe(401);
    });
  }
  describe('PATCH /lineups/:id/metadata', describePatchMetadata);

  // ── GET /lineups/:id — response shape ────────────────────────

  function describeDetailShape() {
    it('should include title + description on detail response', async () => {
      const createRes = await createLineup(adminToken, {
        title: 'Detail Shape Lineup',
        description: 'Body copy shown in modal',
      });
      const id = createRes.body.id as number;

      const res = await testApp.request
        .get(`/lineups/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        title: 'Detail Shape Lineup',
        description: 'Body copy shown in modal',
      });
    });
  }
  describe('GET /lineups/:id — title & description shape', describeDetailShape);
}

describe('Lineup metadata (integration, ROK-1063)', describeLineupMetadata);
