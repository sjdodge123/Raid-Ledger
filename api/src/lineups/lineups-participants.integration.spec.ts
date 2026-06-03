/**
 * Lineup participants roster integration tests (ROK-1346).
 *
 * TDD gate (TDD_WRITE_FAILING): these define the expected behavior of the
 * new `GET /lineups/:id/participants` endpoint + roster helper. They MUST
 * fail until the dev agent (Step 2e) ships the contract schema, the
 * `lineups-participants.helpers.ts` roster query, the service
 * `getParticipants(id, userId)` method, and the controller route.
 *
 * Many assertions fail "by construction" today: the route does not exist
 * (Nest returns 404 for `GET /lineups/:id/participants`), so the status
 * assertions fail before reaching the body checks. That is expected and
 * acceptable for the failing-first gate.
 *
 * Covers spec ACs 3, 4, 7 + edge cases:
 *  - Public: deduped union of creator + nominators + voters; status
 *    derivation (`voted` > `nominated` > `waiting`); role precedence
 *    (`creator` > `invitee` > `participant`).
 *  - Private: creator + invitees, statuses derived.
 *  - Deactivated users excluded.
 *  - Visibility guard: a non-member viewer of a private lineup cannot read
 *    the roster (mirrors `GET /lineups/:id` access intent per the spec).
 *  - Response item shape: userId, displayName, avatar, customAvatarUrl,
 *    discordId, role, status, steamLinked.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

interface ParticipantRow {
  userId: number;
  displayName: string;
  avatar: string | null;
  customAvatarUrl: string | null;
  discordId: string | null;
  role: 'creator' | 'invitee' | 'participant';
  status: 'nominated' | 'voted' | 'waiting';
  steamLinked: boolean;
}

function describeParticipants() {
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

  async function createPublicLineup(token: string) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Public Roster Lineup', visibility: 'public' });
  }

  async function createPrivateLineup(token: string, inviteeUserIds: number[]) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Private Roster Lineup',
        visibility: 'private',
        inviteeUserIds,
      });
  }

  async function nominate(lineupId: number, gameId: number, userId: number) {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId,
      nominatedBy: userId,
    });
  }

  async function castVote(lineupId: number, gameId: number, userId: number) {
    await testApp.db.insert(schema.communityLineupVotes).values({
      lineupId,
      gameId,
      userId,
    });
  }

  function getParticipants(lineupId: number, token: string) {
    return testApp.request
      .get(`/lineups/${lineupId}/participants`)
      .set('Authorization', `Bearer ${token}`);
  }

  // ── AC4: public union + dedup + status ────────────────────────

  it('public lineup returns deduped union of creator + nominators + voters (AC4)', async () => {
    const nominator = await createMember('nom@test.local', 'nom');
    const voter = await createMember('vot@test.local', 'vot');
    const bothUser = await createMember('both@test.local', 'both');

    const createRes = await createPublicLineup(adminToken);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    const gameId = testApp.seed.game.id;

    // nominator-only nominates; voter-only votes; bothUser does both.
    await nominate(lineupId, gameId, nominator.id);
    await nominate(lineupId, gameId, bothUser.id);
    await castVote(lineupId, gameId, voter.id);
    await castVote(lineupId, gameId, bothUser.id);

    const res = await getParticipants(lineupId, adminToken);
    expect(res.status).toBe(200);

    const participants = res.body.participants as ParticipantRow[];
    // creator (admin) + nominator + voter + bothUser = 4 distinct users.
    const ids = participants.map((p) => p.userId).sort((a, b) => a - b);
    const expected = [
      testApp.seed.adminUser.id,
      nominator.id,
      voter.id,
      bothUser.id,
    ].sort((a, b) => a - b);
    expect(ids).toEqual(expected);

    // Dedup: bothUser appears exactly once.
    expect(participants.filter((p) => p.userId === bothUser.id)).toHaveLength(1);
  });

  it('derives status: voted > nominated > waiting (AC4)', async () => {
    const nominator = await createMember('s-nom@test.local', 'snom');
    const voter = await createMember('s-vot@test.local', 'svot');
    const bothUser = await createMember('s-both@test.local', 'sboth');

    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const gameId = testApp.seed.game.id;

    await nominate(lineupId, gameId, nominator.id);
    await nominate(lineupId, gameId, bothUser.id);
    await castVote(lineupId, gameId, voter.id);
    await castVote(lineupId, gameId, bothUser.id);

    const res = await getParticipants(lineupId, adminToken);
    expect(res.status).toBe(200);
    const byId = new Map(
      (res.body.participants as ParticipantRow[]).map((p) => [p.userId, p]),
    );

    // A user who both nominated and voted appears once with status `voted`.
    expect(byId.get(bothUser.id)!.status).toBe('voted');
    // Nominator-only = `nominated`.
    expect(byId.get(nominator.id)!.status).toBe('nominated');
    // Voter-only = `voted`.
    expect(byId.get(voter.id)!.status).toBe('voted');
    // Creator who took no nominate/vote action = `waiting`.
    expect(byId.get(testApp.seed.adminUser.id)!.status).toBe('waiting');
  });

  it('public lineup with zero nominations/votes returns just the creator (edge)', async () => {
    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;

    const res = await getParticipants(lineupId, adminToken);
    expect(res.status).toBe(200);
    const participants = res.body.participants as ParticipantRow[];
    expect(participants).toHaveLength(1);
    expect(participants[0].userId).toBe(testApp.seed.adminUser.id);
    expect(participants[0].role).toBe('creator');
    expect(participants[0].status).toBe('waiting');
  });

  it('role precedence: creator who also voted keeps role `creator`, status reflects the vote', async () => {
    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const gameId = testApp.seed.game.id;

    // The creator (admin) also nominates AND votes.
    await nominate(lineupId, gameId, testApp.seed.adminUser.id);
    await castVote(lineupId, gameId, testApp.seed.adminUser.id);

    const res = await getParticipants(lineupId, adminToken);
    expect(res.status).toBe(200);
    const me = (res.body.participants as ParticipantRow[]).find(
      (p) => p.userId === testApp.seed.adminUser.id,
    )!;
    expect(me.role).toBe('creator');
    expect(me.status).toBe('voted');
  });

  // ── AC3: private invitees + creator ──────────────────────────

  it('private lineup returns creator + invitees with derived statuses (AC3)', async () => {
    const invitee = await createMember('p-inv@test.local', 'pinv');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const res = await getParticipants(lineupId, adminToken);
    expect(res.status).toBe(200);
    const participants = res.body.participants as ParticipantRow[];

    const ids = participants.map((p) => p.userId).sort((a, b) => a - b);
    expect(ids).toEqual(
      [testApp.seed.adminUser.id, invitee.id].sort((a, b) => a - b),
    );

    const creator = participants.find(
      (p) => p.userId === testApp.seed.adminUser.id,
    )!;
    expect(creator.role).toBe('creator');

    const inviteeRow = participants.find((p) => p.userId === invitee.id)!;
    expect(inviteeRow.role).toBe('invitee');
    // No nominate/vote yet → waiting.
    expect(inviteeRow.status).toBe('waiting');
  });

  // ── Deactivated users excluded ───────────────────────────────

  it('excludes deactivated users from the roster (edge)', async () => {
    const active = await createMember('act@test.local', 'act');
    const gone = await createMember('gone@test.local', 'gone');

    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const gameId = testApp.seed.game.id;

    await nominate(lineupId, gameId, active.id);
    await castVote(lineupId, gameId, gone.id);

    // Deactivate `gone`.
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gone.id));

    const res = await getParticipants(lineupId, adminToken);
    expect(res.status).toBe(200);
    const ids = (res.body.participants as ParticipantRow[]).map(
      (p) => p.userId,
    );
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(gone.id);
  });

  // ── Visibility guard ─────────────────────────────────────────

  it('a non-member viewer of a private lineup cannot read its roster (visibility guard)', async () => {
    const invitee = await createMember('vg-inv@test.local', 'vginv');
    const outsider = await createMember('vg-out@test.local', 'vgout');

    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    // Positive control: the creator MUST be able to read the roster (200).
    // This proves the route exists and the 403/404 below is the guard
    // firing — not the route simply being absent. Today the endpoint is
    // missing, so this 200 expectation fails-by-construction.
    const allowed = await getParticipants(lineupId, adminToken);
    expect(allowed.status).toBe(200);

    const res = await getParticipants(lineupId, outsider.token);
    // Mirror GET /lineups/:id access rules — the outsider must not see the
    // private roster. Spec calls for 403/404 (no leak).
    expect([403, 404]).toContain(res.status);
  });

  it('an invitee CAN read the roster of a private lineup they belong to', async () => {
    const invitee = await createMember('vg-ok@test.local', 'vgok');
    const createRes = await createPrivateLineup(adminToken, [invitee.id]);
    const lineupId = createRes.body.id as number;

    const res = await getParticipants(lineupId, invitee.token);
    expect(res.status).toBe(200);
    const ids = (res.body.participants as ParticipantRow[]).map(
      (p) => p.userId,
    );
    expect(ids).toContain(invitee.id);
  });

  it('returns 200 for a real lineup but 404 for a nonexistent one', async () => {
    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;

    // Positive control: an existing lineup resolves (200). Distinguishes the
    // "route missing → 404 everywhere" state from the real "unknown id → 404"
    // behavior. Today the route is absent, so this 200 fails-by-construction.
    const ok = await getParticipants(lineupId, adminToken);
    expect(ok.status).toBe(200);

    const missing = await getParticipants(999999, adminToken);
    expect(missing.status).toBe(404);
  });

  // ── Response item shape ──────────────────────────────────────

  it('roster items carry the full participant shape (AC7)', async () => {
    const member = await createMember('shape@test.local', 'shape');
    // Give the member a profile with steam + avatar fields populated.
    await testApp.db
      .update(schema.users)
      .set({
        discordId: 'discord:shape',
        steamId: 'steam:shape',
        avatar: 'avatar-hash',
        customAvatarUrl: 'https://cdn.example/shape.png',
        displayName: 'Shape Person',
      })
      .where(eq(schema.users.id, member.id));

    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    await castVote(lineupId, testApp.seed.game.id, member.id);

    const res = await getParticipants(lineupId, adminToken);
    expect(res.status).toBe(200);
    const row = (res.body.participants as ParticipantRow[]).find(
      (p) => p.userId === member.id,
    )!;

    expect(row).toMatchObject({
      userId: member.id,
      displayName: 'Shape Person',
      avatar: 'avatar-hash',
      customAvatarUrl: 'https://cdn.example/shape.png',
      discordId: 'discord:shape',
      role: 'participant',
      status: 'voted',
      steamLinked: true,
    });
    // Every documented key is present (shape contract).
    expect(Object.keys(row).sort()).toEqual(
      [
        'avatar',
        'customAvatarUrl',
        'discordId',
        'displayName',
        'role',
        'status',
        'steamLinked',
        'userId',
      ].sort(),
    );
  });
}

describe('Lineups — participants roster (integration)', describeParticipants);
