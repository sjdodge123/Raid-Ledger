/**
 * ROK-2096 — `POST /admin/hubs` seeds the hub's first members alongside the
 * leader (operator ruling 2026-11-05). Real DB + HTTP.
 */
import { eq } from 'drizzle-orm';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import * as schema from '../../drizzle/schema';
import { CREATE_MEMBER_ERRORS } from './community-create-members.helpers';

let testApp: TestApp;
let seq = 0;

async function seedUser(
  username: string,
  deactivated = false,
): Promise<number> {
  seq += 1;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `91000000000000${String(seq).padStart(4, '0')}`,
        username,
        role: 'member',
        guildMemberSeenAt: new Date(),
        deactivatedAt: deactivated ? new Date() : null,
      })
      .returning(),
    `user ${username}`,
  );
  return user.id;
}

async function adminAuth(): Promise<{ Authorization: string }> {
  const admin = testApp.seed.adminUser;
  const token = await signTestAccessToken(testApp, {
    sub: admin.id,
    username: admin.username,
    role: admin.role,
  });
  return { Authorization: `Bearer ${token}` };
}

async function create(body: {
  name: string;
  leaderUserId: number;
  memberUserIds?: number[];
}) {
  return testApp.request
    .post('/admin/hubs')
    .set(await adminAuth())
    .send({ gameId: testApp.seed.game.id, blurb: 'Seeded by staff', ...body });
}

async function membersOf(guildId: number) {
  const rows = await testApp.db
    .select({
      userId: schema.hubCommunityMembers.userId,
      role: schema.hubCommunityMembers.role,
      joinSource: schema.hubCommunityMembers.joinSource,
    })
    .from(schema.hubCommunityMembers)
    .where(eq(schema.hubCommunityMembers.guildId, guildId));
  return rows.sort((a, b) => a.userId - b.userId);
}

async function hubCount(): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(eq(schema.guilds.kind, 'game_community'));
  return rows.length;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('POST /admin/hubs with memberUserIds (ROK-2096)', () => {
  it('seeds a member row per listed user and counts them', async () => {
    const leader = await seedUser('m1-leader');
    const a = await seedUser('m1-a');
    const b = await seedUser('m1-b');

    const res = await create({
      name: 'Gamergoons',
      leaderUserId: leader,
      memberUserIds: [a, b],
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({ name: 'Gamergoons', memberCount: 3 }),
    );
    expect(await membersOf(res.body.id as number)).toEqual(
      [
        { userId: leader, role: 'leader', joinSource: null },
        { userId: a, role: 'member', joinSource: null },
        { userId: b, role: 'member', joinSource: null },
      ].sort((x, y) => x.userId - y.userId),
    );
  });

  it('ignores the leader and duplicates in memberUserIds', async () => {
    const leader = await seedUser('m2-leader');
    const a = await seedUser('m2-a');

    const res = await create({
      name: 'Dupes',
      leaderUserId: leader,
      memberUserIds: [a, leader, a],
    });

    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(2);
    const rows = await membersOf(res.body.id as number);
    expect(rows.find((r) => r.userId === leader)?.role).toBe('leader');
    expect(rows).toHaveLength(2);
  });

  it('an unknown member is 404 and writes nothing', async () => {
    const leader = await seedUser('m3-leader');

    const res = await create({
      name: 'Ghosts',
      leaderUserId: leader,
      memberUserIds: [999999],
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(CREATE_MEMBER_ERRORS.notFound);
    expect(await hubCount()).toBe(0);
  });

  it('a deactivated member is 409 and writes nothing', async () => {
    const leader = await seedUser('m4-leader');
    const gone = await seedUser('m4-gone', true);

    const res = await create({
      name: 'Leavers',
      leaderUserId: leader,
      memberUserIds: [gone],
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CREATE_MEMBER_ERRORS.inactive);
    expect(await hubCount()).toBe(0);
  });

  it('omitting memberUserIds keeps the leader-only create', async () => {
    const leader = await seedUser('m5-leader');

    const res = await create({ name: 'Solo', leaderUserId: leader });

    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(1);
  });
});
