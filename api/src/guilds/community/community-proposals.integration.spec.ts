/**
 * ROK-1870 §2.7 P1–P12 — community hub proposals against a real DB:
 *
 *   POST   /hubs/proposals                      propose (A2 Discord gate, D11, D12)
 *   DELETE /hubs/proposals/:id                  proposer withdraws
 *   POST   /admin/hubs/proposals/:id/approve    D8 — active + proposer leads
 *   POST   /admin/hubs/proposals/:id/reject     A1 — notify, then delete
 *   POST   /admin/hubs                          direct create with a leader
 *   GET    /guilds/:id                          A7 — proposed is staff-only
 *
 * A2 ("in the community Discord") is a DB read of `discord_id` +
 * `guild_member_seen_at`, so the gate is driven by seeding those columns —
 * no Discord client stub. Notification rows are asserted through the
 * `notifications` table. Every session is minted with `signTestAccessToken`
 * (ROK-1823); THROTTLE_DISABLED (integration-setup) lifts the 5/h tier.
 */
import { and, eq } from 'drizzle-orm';
import type { UserRole } from '@raid-ledger/contract';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import * as schema from '../../drizzle/schema';
import { wipeUserData } from '../../users/users-delete.helpers';
import { PROPOSAL_ERRORS } from './community-proposals.service';

type UserRow = typeof schema.users.$inferSelect;

interface Session {
  user: UserRow;
  auth: { Authorization: string };
}

let testApp: TestApp;
let discordSeq = 0;

/** A user row; `inDiscord` stamps the A2 columns (discord id + seen-at). */
async function seedUser(
  username: string,
  opts: { inDiscord?: boolean; role?: UserRole } = {},
): Promise<Session> {
  discordSeq += 1;
  const inDiscord = opts.inDiscord ?? true;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `90000000000000${String(discordSeq).padStart(4, '0')}`,
        username,
        role: opts.role ?? 'member',
        guildMemberSeenAt: inDiscord ? new Date() : null,
      })
      .returning(),
    `user ${username}`,
  );
  return sessionFor(user);
}

async function sessionFor(user: UserRow): Promise<Session> {
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  return { user, auth: { Authorization: `Bearer ${token}` } };
}

/** The seeded baseline admin as a session. */
function adminSession(): Promise<Session> {
  return sessionFor(testApp.seed.adminUser);
}

/** A second game (game H in the matrix). */
async function seedGame(name: string): Promise<number> {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') })
      .returning(),
    `game ${name}`,
  );
  return game.id;
}

/** A community hub row inserted directly (no route), e.g. a P3/P4 fixture. */
async function seedHub(
  gameId: number,
  name: string,
  status: 'active' | 'archived',
): Promise<number> {
  const archived = status === 'archived';
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.trim().toLowerCase(),
        blurb: 'A fixture hub',
        status,
        archivedAt: archived ? new Date() : null,
        archivedReason: archived ? 'admin' : null,
      })
      .returning(),
    `hub ${name}`,
  );
  return hub.id;
}

const gameG = (): number => testApp.seed.game.id;

function propose(
  who: Session,
  body: { gameId: number; name: string; blurb?: string },
) {
  return testApp.request
    .post('/hubs/proposals')
    .set(who.auth)
    .send({ blurb: 'We play together on weekends', ...body });
}

/** POST a proposal that must succeed; returns its id. */
async function proposeOk(
  who: Session,
  body: { gameId: number; name: string },
): Promise<number> {
  const res = await propose(who, body);
  expect(res.status).toBe(201);
  return res.body.id as number;
}

const approve = (who: Session, id: number, body: object = {}) =>
  testApp.request
    .post(`/admin/hubs/proposals/${id}/approve`)
    .set(who.auth)
    .send(body);

const reject = (who: Session, id: number, reason: string) =>
  testApp.request
    .post(`/admin/hubs/proposals/${id}/reject`)
    .set(who.auth)
    .send({ reason });

async function hubRow(id: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.guilds)
    .where(eq(schema.guilds.id, id));
  return row;
}

function membersOf(guildId: number) {
  return testApp.db
    .select()
    .from(schema.hubCommunityMembers)
    .where(eq(schema.hubCommunityMembers.guildId, guildId));
}

function noticesFor(
  userId: number,
  type: 'hub_proposal_submitted' | 'hub_proposal_reviewed',
) {
  return testApp.db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, type),
      ),
    );
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('POST /hubs/proposals', () => {
  it('P1 a Discord-guild member proposes: 201, proposed row, no member row, staff notified', async () => {
    const proposer = await seedUser('p1-proposer');
    const res = await propose(proposer, { gameId: gameG(), name: 'BG3 Crew' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        gameId: gameG(),
        name: 'BG3 Crew',
        proposedBy: expect.objectContaining({ userId: proposer.user.id }),
      }),
    );
    const id = res.body.id as number;
    const row = await hubRow(id);
    expect(row?.kind).toBe('game_community');
    expect(row?.status).toBe('proposed');
    expect(row?.proposedBy).toBe(proposer.user.id);
    expect(await membersOf(id)).toHaveLength(0);

    const notices = await noticesFor(
      testApp.seed.adminUser.id,
      'hub_proposal_submitted',
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toEqual(
      expect.objectContaining({
        proposalId: id,
        hubName: 'BG3 Crew',
        gameName: testApp.seed.game.name,
        url: '/admin/settings/general/hubs',
      }),
    );
    expect(
      await noticesFor(proposer.user.id, 'hub_proposal_submitted'),
    ).toHaveLength(0);
  });

  it('P2 a user with guild_member_seen_at NULL is refused 403 not-in-discord', async () => {
    const outsider = await seedUser('p2-outsider', { inDiscord: false });
    const res = await propose(outsider, { gameId: gameG(), name: 'BG3 Crew' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(PROPOSAL_ERRORS.notInDiscord);
    const rows = await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.kind, 'game_community'));
    expect(rows).toHaveLength(0);
  });
});

describe('POST /hubs/proposals — D11 names + D12 limits', () => {
  it('P3 a case-insensitive name clash on game G is 409; the same name on game H is 201', async () => {
    const gameH = await seedGame('Game H Proposals');
    await seedHub(gameG(), 'BG3 Crew', 'active');
    const proposer = await seedUser('p3-proposer');

    const clash = await propose(proposer, {
      gameId: gameG(),
      name: 'bg3 crew',
    });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toBe(PROPOSAL_ERRORS.nameTaken);

    const other = await propose(proposer, { gameId: gameH, name: 'bg3 crew' });
    expect(other.status).toBe(201);
    expect(other.body.gameId).toBe(gameH);
  });

  it('P4 an archived "BG3 Crew" on G frees the name: 201', async () => {
    await seedHub(gameG(), 'BG3 Crew', 'archived');
    const proposer = await seedUser('p4-proposer');

    const res = await propose(proposer, { gameId: gameG(), name: 'BG3 Crew' });
    expect(res.status).toBe(201);
    expect((await hubRow(res.body.id as number))?.status).toBe('proposed');
  });

  it('P5 a second open proposal on G is 409 pending-for-game; a 3rd overall is 409 limit', async () => {
    const gameH = await seedGame('Game H Limits');
    const gameI = await seedGame('Game I Limits');
    const proposer = await seedUser('p5-proposer');
    await proposeOk(proposer, { gameId: gameG(), name: 'First Crew' });

    const sameGame = await propose(proposer, {
      gameId: gameG(),
      name: 'Second Crew',
    });
    expect(sameGame.status).toBe(409);
    expect(sameGame.body.message).toBe(PROPOSAL_ERRORS.pendingForGame);

    await proposeOk(proposer, { gameId: gameH, name: 'Second Crew' });
    const third = await propose(proposer, {
      gameId: gameI,
      name: 'Third Crew',
    });
    expect(third.status).toBe(409);
    expect(third.body.message).toBe(PROPOSAL_ERRORS.limit);

    const mine = await testApp.request
      .get('/hubs/proposals/mine')
      .set(proposer.auth);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(2);
  });
});

describe('proposal ownership + admin guard', () => {
  it('P6 a non-proposer DELETE is 404; a non-admin approve is 403', async () => {
    const proposer = await seedUser('p6-proposer');
    const stranger = await seedUser('p6-stranger');
    const id = await proposeOk(proposer, { gameId: gameG(), name: 'P6 Crew' });

    const del = await testApp.request
      .delete(`/hubs/proposals/${id}`)
      .set(stranger.auth);
    expect(del.status).toBe(404);

    const approved = await approve(stranger, id);
    expect(approved.status).toBe(403);

    const row = await hubRow(id);
    expect(row?.status).toBe('proposed');
    expect(await membersOf(id)).toHaveLength(0);
  });
});

describe('POST /admin/hubs/proposals/:id/approve|reject', () => {
  it('P7 approve with rename: 200, active, proposer is leader, member_count 1, proposer notified', async () => {
    const proposer = await seedUser('p7-proposer');
    const admin = await adminSession();
    const id = await proposeOk(proposer, { gameId: gameG(), name: 'P7 Draft' });

    const res = await approve(admin, id, { name: 'P7 Final Crew' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        id,
        name: 'P7 Final Crew',
        status: 'active',
        memberCount: 1,
      }),
    );

    const row = await hubRow(id);
    expect(row?.status).toBe('active');
    expect(row?.name).toBe('P7 Final Crew');
    expect(row?.memberCount).toBe(1);
    expect(row?.reviewedBy).toBe(testApp.seed.adminUser.id);
    const members = await membersOf(id);
    expect(members).toHaveLength(1);
    expect(members[0]).toEqual(
      expect.objectContaining({
        userId: proposer.user.id,
        role: 'leader',
        leftAt: null,
        bannedAt: null,
      }),
    );

    const notices = await noticesFor(proposer.user.id, 'hub_proposal_reviewed');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toEqual(
      expect.objectContaining({
        outcome: 'approved',
        proposalId: id,
        hubName: 'P7 Final Crew',
        guildId: id,
        url: `/guilds/${id}`,
      }),
    );
  });
});

describe('POST /admin/hubs/proposals/:id/reject + deactivated approve', () => {
  it('P8 reject with a reason: 204, row gone, proposer notification carries the reason', async () => {
    const proposer = await seedUser('p8-proposer');
    const admin = await adminSession();
    const id = await proposeOk(proposer, { gameId: gameG(), name: 'P8 Crew' });
    const reason = 'There is already an active hub for this playgroup';

    const res = await reject(admin, id, reason);
    expect(res.status).toBe(204);
    expect(await hubRow(id)).toBeUndefined();

    const notices = await noticesFor(proposer.user.id, 'hub_proposal_reviewed');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toBe(reason);
    expect(notices[0]?.payload).toEqual(
      expect.objectContaining({
        outcome: 'rejected',
        reason,
        proposalId: id,
        hubName: 'P8 Crew',
        gameName: testApp.seed.game.name,
      }),
    );
  });

  it("P9 approving a deactivated proposer's proposal is 409", async () => {
    const proposer = await seedUser('p9-proposer');
    const admin = await adminSession();
    const id = await proposeOk(proposer, { gameId: gameG(), name: 'P9 Crew' });
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, proposer.user.id));

    const res = await approve(admin, id);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(PROPOSAL_ERRORS.proposerInactive);
    expect((await hubRow(id))?.status).toBe('proposed');
    expect(await membersOf(id)).toHaveLength(0);
    expect(
      await noticesFor(proposer.user.id, 'hub_proposal_reviewed'),
    ).toHaveLength(0);
  });
});

describe('POST /admin/hubs', () => {
  it('P10 admin direct create with leaderUserId: 201, leader row for that user', async () => {
    const leader = await seedUser('p10-leader');
    const admin = await adminSession();

    const res = await testApp.request.post('/admin/hubs').set(admin.auth).send({
      gameId: gameG(),
      name: 'P10 Direct Crew',
      blurb: 'Seeded by staff',
      leaderUserId: leader.user.id,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        name: 'P10 Direct Crew',
        status: 'active',
        memberCount: 1,
      }),
    );

    const id = res.body.id as number;
    const row = await hubRow(id);
    expect(row?.kind).toBe('game_community');
    expect(row?.status).toBe('active');
    expect(row?.proposedBy).toBeNull();
    const members = await membersOf(id);
    expect(members).toHaveLength(1);
    expect(members[0]).toEqual(
      expect.objectContaining({ userId: leader.user.id, role: 'leader' }),
    );
  });
});

describe('A7 visibility of a proposed hub', () => {
  it('P11 a proposed hub is 404 to a non-staff viewer and to its proposer; staff get 200', async () => {
    const proposer = await seedUser('p11-proposer');
    const viewer = await seedUser('p11-viewer');
    const admin = await adminSession();
    const id = await proposeOk(proposer, { gameId: gameG(), name: 'P11 Crew' });
    const page = (who: Session) =>
      testApp.request.get(`/guilds/${id}`).set(who.auth);

    expect((await page(viewer)).status).toBe(404);
    expect((await page(proposer)).status).toBe(404);
    const staff = await page(admin);
    expect(staff.status).toBe(200);
    // The hub page nests the summary under `guild` (GuildPage), not at the root.
    expect(staff.body.guild.id).toBe(id);
    expect(staff.body.status).toBe('proposed');
  });
});

describe('concurrent review', () => {
  it('P12 two concurrent approvals: one 200, one 404 (row no longer proposed)', async () => {
    const proposer = await seedUser('p12-proposer');
    const admin = await adminSession();
    const id = await proposeOk(proposer, { gameId: gameG(), name: 'P12 Crew' });

    const results = await Promise.all([approve(admin, id), approve(admin, id)]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 404]);

    expect((await hubRow(id))?.status).toBe('active');
    const members = await membersOf(id);
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('leader');
    expect(
      await noticesFor(proposer.user.id, 'hub_proposal_reviewed'),
    ).toHaveLength(1);
  });
});

describe('user wipe', () => {
  it('P13 wiping a proposer deletes their pending proposal and frees the name', async () => {
    const proposer = await seedUser('p13-proposer');
    const other = await seedUser('p13-other');
    const res = await propose(proposer, { gameId: gameG(), name: 'P13 Crew' });
    expect(res.status).toBe(201);
    await testApp.db.transaction((tx) =>
      wipeUserData(tx, proposer.user.id, other.user.id),
    );
    const gone = await testApp.db
      .select({ id: schema.guilds.id })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, Number(res.body.id)));
    expect(gone).toEqual([]);
    expect(
      (await propose(other, { gameId: gameG(), name: 'P13 Crew' })).status,
    ).toBe(201);
  });
});
