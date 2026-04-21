/**
 * Private / targeted lineup integration tests (ROK-1065).
 *
 * Covers spec Test-plan ACs that were missing from the bundled change:
 * - I1: create private lineup with empty invitees → 400
 * - I2: non-invitee nominate on private lineup → 403 (HTTP path)
 * - I6: carryover filters out private decided lineups
 * - I7: common-ground explicit lineupId vs fallback
 * - I8: remove-invitee preserves prior votes
 * - Invitee CRUD dedupe + non-creator 403
 * - A6: findInviteeDiscordMembers creator-union, DISTINCT dedupe, NULL discord_id filter
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { findInviteeDiscordMembers } from './lineup-notification-targets.helpers';

function describePrivateLineups() {
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

  async function createMember(
    email: string,
    username: string,
    role: 'member' | 'operator' = 'member',
  ): Promise<{ id: number; token: string }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('Pass1Pass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username,
        role,
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'Pass1Pass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  async function createPrivateLineup(token: string, inviteeUserIds: number[]) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Private Lineup',
        visibility: 'private',
        inviteeUserIds,
      });
  }

  // ── I1: empty invitees → 400 ─────────────────────────────────

  it('rejects a private lineup with an empty invitee list (I1)', async () => {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Empty',
        visibility: 'private',
        inviteeUserIds: [],
      });
    expect(res.status).toBe(400);
  });

  it('rejects a private lineup with no inviteeUserIds field (I1)', async () => {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Missing',
        visibility: 'private',
      });
    expect(res.status).toBe(400);
  });

  // ── I2: non-invitee nominate → 403 ───────────────────────────

  it('blocks non-invitee nominate on private lineup with 403 (I2)', async () => {
    const invitee = await createMember('invitee@test.local', 'invitee');
    const outsider = await createMember('outsider@test.local', 'outsider');

    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .post(`/lineups/${lineupId}/nominate`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ gameId: testApp.seed.game.id });

    expect(res.status).toBe(403);
  });

  it('allows an invitee to nominate on a private lineup', async () => {
    const invitee = await createMember('invitee2@test.local', 'invitee2');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .post(`/lineups/${lineupId}/nominate`)
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ gameId: testApp.seed.game.id });

    expect(res.status).toBe(201);
  });

  // ── Invitee CRUD: dedupe + 403 non-creator ───────────────────

  it('dedupes repeated invitee IDs via ON CONFLICT DO NOTHING', async () => {
    const a = await createMember('dup-a@test.local', 'dupa');
    const createRes = await createPrivateLineup(adminToken, [a.id]);
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .post(`/lineups/${lineupId}/invitees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [a.id, a.id] });

    expect(res.status).toBe(201);
    const invitees = res.body.invitees as { id: number }[];
    expect(invitees.filter((i) => i.id === a.id)).toHaveLength(1);
  });

  it('returns 403 when a non-creator member tries to add invitees', async () => {
    const invitee = await createMember('existing@test.local', 'existing');
    const outsider = await createMember('out-member@test.local', 'outmem');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .post(`/lineups/${lineupId}/invitees`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ userIds: [outsider.id] });

    expect(res.status).toBe(403);
  });

  it('returns 400 when add-invitees body has an empty userIds array', async () => {
    const invitee = await createMember('x@test.local', 'x');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .post(`/lineups/${lineupId}/invitees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [] });

    expect(res.status).toBe(400);
  });

  // ── I8: remove-invitee preserves past votes ──────────────────

  it('preserves prior votes when an invitee is removed (I8)', async () => {
    const invitee = await createMember('voter@test.local', 'voter');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    // Nominate a game so there's something to vote on.
    await testApp.request
      .post(`/lineups/${lineupId}/nominate`)
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ gameId: testApp.seed.game.id });
    // Transition to voting.
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'voting' });
    // Invitee casts a vote.
    await testApp.request
      .post(`/lineups/${lineupId}/vote`)
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ gameId: testApp.seed.game.id });

    const votesBefore = await testApp.db
      .select()
      .from(schema.communityLineupVotes)
      .where(eq(schema.communityLineupVotes.lineupId, lineupId));
    expect(votesBefore).toHaveLength(1);

    // Now remove the invitee.
    const removeRes = await testApp.request
      .delete(`/lineups/${lineupId}/invitees/${invitee.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removeRes.status).toBe(200);

    const votesAfter = await testApp.db
      .select()
      .from(schema.communityLineupVotes)
      .where(eq(schema.communityLineupVotes.lineupId, lineupId));
    expect(votesAfter).toHaveLength(1);
    expect(votesAfter[0].userId).toBe(invitee.id);
  });

  // ── I6: carryover skips private decided lineups ──────────────

  it('carryover does not pull suggestions from a decided private lineup (I6)', async () => {
    const invitee = await createMember('carryover@test.local', 'co');
    // Private decided lineup with a match in decided phase.
    const privateRes = await createPrivateLineup(adminToken, [invitee.id]);
    const privateId = privateRes.body.id as number;

    // Seed a suggested match on the private lineup so carryover would
    // otherwise pick it up.
    await testApp.db.insert(schema.communityLineupMatches).values({
      lineupId: privateId,
      gameId: testApp.seed.game.id,
      status: 'suggested',
      voteCount: 5,
      thresholdMet: true,
    });
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'decided' })
      .where(eq(schema.communityLineups.id, privateId));

    // New public lineup — carryover fires inside create.
    const publicRes = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Next public' });
    expect(publicRes.status).toBe(201);
    const publicId = publicRes.body.id as number;

    // No carryover rows should exist on the new public lineup.
    const carried = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.lineupId, publicId));
    expect(carried).toHaveLength(0);
  });

  // ── I7: common-ground explicit lineupId vs fallback ──────────

  it('common-ground honors explicit lineupId for a private lineup (I7)', async () => {
    const invitee = await createMember('cg@test.local', 'cg');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .get('/lineups/common-ground')
      .query({ lineupId })
      .set('Authorization', `Bearer ${adminToken}`);

    // Explicit lineupId path — request succeeds and echoes the private
    // lineup as the active one in meta.
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.activeLineupId).toBe(lineupId);
  });

  // ── A6: findInviteeDiscordMembers creator-union ──────────────

  it('findInviteeDiscordMembers includes the creator even when not invited (A6)', async () => {
    // Admin (seed user) creates the lineup but is NOT in inviteeUserIds.
    // The DISTINCT union in findInviteeDiscordMembers should still return
    // the creator alongside the invitee.
    const invitee = await createMember('a6-invitee@test.local', 'a6invitee');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    // Give the creator a Discord ID so the `discord_id IS NOT NULL` filter
    // lets them through.
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'discord:admin-a6' })
      .where(eq(schema.users.id, testApp.seed.adminUser.id));
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'discord:a6-invitee' })
      .where(eq(schema.users.id, invitee.id));

    const members = await findInviteeDiscordMembers(testApp.db, lineupId);
    const ids = members.map((m) => m.userId).sort();
    expect(ids).toContain(testApp.seed.adminUser.id);
    expect(ids).toContain(invitee.id);
    // DISTINCT guard: no duplicates even if the creator is also an invitee
    // in a separate setup — this case covers union, dedupe is the next test.
  });

  it('findInviteeDiscordMembers dedupes when the creator is also an explicit invitee', async () => {
    // Explicitly invite the admin so the union has a collision.
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'discord:admin-dup' })
      .where(eq(schema.users.id, testApp.seed.adminUser.id));

    const invitee = await createMember('dup-inv@test.local', 'dupinv');
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'discord:dup-inv' })
      .where(eq(schema.users.id, invitee.id));

    const createRes = await createPrivateLineup(adminToken, [
      testApp.seed.adminUser.id,
      invitee.id,
    ]);
    const lineupId = createRes.body.id as number;

    const members = await findInviteeDiscordMembers(testApp.db, lineupId);
    const adminCount = members.filter(
      (m) => m.userId === testApp.seed.adminUser.id,
    ).length;
    expect(adminCount).toBe(1);
  });

  it('findInviteeDiscordMembers excludes users with no discord_id', async () => {
    const withDiscord = await createMember('with-d@test.local', 'withd');
    const withoutDiscord = await createMember('no-d@test.local', 'nod');
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'discord:with-d' })
      .where(eq(schema.users.id, withDiscord.id));
    await testApp.db
      .update(schema.users)
      .set({ discordId: null })
      .where(eq(schema.users.id, withoutDiscord.id));

    const createRes = await createPrivateLineup(adminToken, [
      withDiscord.id,
      withoutDiscord.id,
    ]);
    const lineupId = createRes.body.id as number;

    const members = await findInviteeDiscordMembers(testApp.db, lineupId);
    const ids = members.map((m) => m.userId);
    expect(ids).toContain(withDiscord.id);
    expect(ids).not.toContain(withoutDiscord.id);
  });

  it('common-ground falls back to the current building lineup when lineupId is omitted', async () => {
    const createRes = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Public CG' });
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .get('/lineups/common-ground')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.activeLineupId).toBe(lineupId);
  });
}

describe('Lineups — private / invitee (integration)', describePrivateLineups);
