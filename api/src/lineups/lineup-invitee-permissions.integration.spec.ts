/**
 * ROK-1440 — invitees on PUBLIC lineups + the creator-can-manage fix.
 *
 * Two behaviours, both previously broken:
 *
 * 1. Invitees were treated as a private-only concept in the web layer, so a
 *    public lineup could not seed known attendees. The API always allowed it
 *    (the create service never checked visibility) — these cases pin that, so
 *    a future visibility guard on the server can't silently re-break the UI.
 *
 * 2. `POST/DELETE /lineups/:id/invitees` were `@Roles('operator')` while the
 *    UI offered "Invite more" to the lineup creator, so a non-operator creator
 *    saw a button that 403'd. Authorization is now creator OR admin/operator.
 *
 * Adding invitees to a public lineup must NOT make it private or disable its
 * public share link — that is the whole point of the operator's ask ("add
 * members I know will be attending while still allowing others to join").
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describeInviteePermissions() {
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

  async function createUser(
    suffix: string,
    role: 'member' | 'operator' = 'member',
  ): Promise<{ id: number; token: string }> {
    const email = `invperm-${suffix}@test.local`;
    const hash = await bcrypt.hash('InvPermPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:invperm-${suffix}`,
        username: `invperm-${suffix}`,
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
      .send({ email, password: 'InvPermPass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  /** Lineups are operator-gated at create, so seed via the operator token. */
  async function createPublicLineup(
    creatorToken: string,
    inviteeUserIds?: number[],
  ) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Public invitee lineup',
        ...(inviteeUserIds ? { inviteeUserIds } : {}),
      });
  }

  function loadInvitees(lineupId: number) {
    return testApp.db
      .select({ userId: schema.communityLineupInvitees.userId })
      .from(schema.communityLineupInvitees)
      .where(eq(schema.communityLineupInvitees.lineupId, lineupId));
  }

  // ── Public lineups accept invitees at create ──────────────────

  it('seeds invitees on a PUBLIC lineup at create without making it private', async () => {
    const alice = await createUser('seed-alice');
    const bob = await createUser('seed-bob');

    const res = await createPublicLineup(adminToken, [alice.id, bob.id]);

    expect(res.status).toBe(201);
    const lineupId = res.body.id as number;
    const [row] = await testApp.db
      .select({
        visibility: schema.communityLineups.visibility,
        publicShareEnabled: schema.communityLineups.publicShareEnabled,
      })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    expect(row.visibility).toBe('public');
    expect(row.publicShareEnabled).toBe(true);
    expect((await loadInvitees(lineupId)).map((i) => i.userId).sort()).toEqual(
      [alice.id, bob.id].sort(),
    );
  });

  it('adds invitees to an existing PUBLIC lineup, leaving visibility alone', async () => {
    const alice = await createUser('add-alice');
    const created = await createPublicLineup(adminToken);
    const lineupId = created.body.id as number;

    const res = await testApp.request
      .post(`/lineups/${lineupId}/invitees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [alice.id] });

    expect(res.status).toBe(201);
    expect(await loadInvitees(lineupId)).toHaveLength(1);
    const [row] = await testApp.db
      .select({ visibility: schema.communityLineups.visibility })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    expect(row.visibility).toBe('public');
  });

  // ── The creator-403 fix ───────────────────────────────────────

  it('lets a non-operator CREATOR add invitees (was 403 under @Roles)', async () => {
    const creator = await createUser('creator');
    const alice = await createUser('creator-alice');
    // Seed the lineup directly so `created_by` is the non-operator user.
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Creator-owned lineup',
        createdBy: creator.id,
        publicSlug: `cr-${creator.id}`,
      })
      .returning();

    const res = await testApp.request
      .post(`/lineups/${lineup.id}/invitees`)
      .set('Authorization', `Bearer ${creator.token}`)
      .send({ userIds: [alice.id] });

    expect(res.status).toBe(201);
    expect(await loadInvitees(lineup.id)).toHaveLength(1);
  });

  it('lets a non-operator CREATOR remove an invitee', async () => {
    const creator = await createUser('rm-creator');
    const alice = await createUser('rm-alice');
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Creator-owned lineup',
        createdBy: creator.id,
        publicSlug: `rm-${creator.id}`,
      })
      .returning();
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values({ lineupId: lineup.id, userId: alice.id });

    const res = await testApp.request
      .delete(`/lineups/${lineup.id}/invitees/${alice.id}`)
      .set('Authorization', `Bearer ${creator.token}`);

    expect(res.status).toBe(200);
    expect(await loadInvitees(lineup.id)).toHaveLength(0);
  });

  it('still 403s a member who is neither creator nor operator', async () => {
    const creator = await createUser('guard-creator');
    const stranger = await createUser('guard-stranger');
    const alice = await createUser('guard-alice');
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Creator-owned lineup',
        createdBy: creator.id,
        publicSlug: `gd-${creator.id}`,
      })
      .returning();

    const res = await testApp.request
      .post(`/lineups/${lineup.id}/invitees`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ userIds: [alice.id] });

    expect(res.status).toBe(403);
    expect(await loadInvitees(lineup.id)).toHaveLength(0);
  });
}

describe(
  'Lineups — invitee permissions + public invitees (integration)',
  describeInviteePermissions,
);
