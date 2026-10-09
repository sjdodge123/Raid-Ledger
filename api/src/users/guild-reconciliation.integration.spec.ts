/**
 * ROK-1749 — the daily guild sweep is scoped to users actually seen in the
 * guild (`users.guild_member_seen_at IS NOT NULL`).
 *
 * Real Postgres; the Discord member fetch is the only seam
 * (`DiscordBotClientService.listAllGuildMemberAvatars` spied, never a real
 * Discord call), mirroring guild-reconciliation.service.integration.spec.ts.
 *
 *   1. never-seen Discord OAuth guest absent from the list survives and can
 *      still vote on a public lineup (NotDeactivatedGuard lets them through);
 *   2. a stamped leaver is deactivated with reason 'reconciliation-sweep' and
 *      the admin notification carries the sweep wording;
 *   3. a run stamps every active member present in the list, not absent /
 *      deactivated / local: / unlinked: rows;
 *   4. stamping runs before the candidate load (a first-seen member is
 *      stamped, kept active and avatar-synced in the same pass);
 *   5. local: / unlinked: ids are never candidates, even when stamped.
 */
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { GuildReconciliationService } from './guild-reconciliation.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { defined } from '../common/testing/narrow';

let testApp: TestApp;
let service: GuildReconciliationService;
let botClient: DiscordBotClientService;
let listSpy: jest.SpyInstance | undefined;

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(GuildReconciliationService);
  botClient = testApp.app.get(DiscordBotClientService);
});

afterEach(async () => {
  listSpy?.mockRestore();
  listSpy = undefined;
  testApp.seed = await truncateAllTables(testApp.db);
});

type UserRow = typeof schema.users.$inferSelect;

async function createUser(
  username: string,
  discordId: string,
  opts: { seen?: Date | null; deactivated?: boolean } = {},
): Promise<UserRow> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId,
      username,
      role: 'member',
      guildMemberSeenAt: opts.seen ?? null,
      deactivatedAt: opts.deactivated ? new Date('2025-01-01T00:00:00Z') : null,
    })
    .returning();
  return defined(user, `inserted user ${username}`);
}

async function readUser(userId: number): Promise<UserRow> {
  const row = await testApp.db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  return defined(row, `user ${userId}`);
}

function mockGuildMembers(ids: string[]): void {
  listSpy = jest
    .spyOn(botClient, 'listAllGuildMemberAvatars')
    .mockResolvedValue(new Map(ids.map((id) => [id, null])));
}

/** Public lineup in `voting` with the seed game nominated (admin-owned). */
async function setupVotingLineup(): Promise<{ lineupId: number }> {
  const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const created = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'Guest vote (ROK-1749)' });
  expect(created.status).toBe(201);
  const lineupId = created.body.id as number;
  await testApp.db.insert(schema.communityLineupEntries).values({
    lineupId,
    gameId: testApp.seed.game.id,
    nominatedBy: testApp.seed.adminUser.id,
  });
  const toVoting = await testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'voting' });
  expect(toVoting.status).toBe(200);
  return { lineupId };
}

describe('GuildReconciliationService — seen-in-guild scoping (ROK-1749)', () => {
  it('keeps a never-seen Discord guest active and able to vote after a run', async () => {
    const guest = await createUser('pugguest', '1749000000000000001');
    const { lineupId } = await setupVotingLineup();
    mockGuildMembers(['1749000000000000099']);

    await service.runReconciliation();

    const after = await readUser(guest.id);
    expect(after.deactivatedAt).toBeNull();
    expect(after.guildMemberSeenAt).toBeNull();

    const token = testApp.app
      .get(JwtService)
      .sign({ sub: guest.id, username: guest.username });
    const vote = await testApp.request
      .post(`/lineups/${lineupId}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId: testApp.seed.game.id });
    expect(vote.status).toBe(200);
  });

  it('deactivates a stamped leaver with the sweep reason and wording', async () => {
    const leaver = await createUser('leaver', '1749000000000000002', {
      seen: new Date('2026-01-01T00:00:00Z'),
    });
    mockGuildMembers([]);

    await service.runReconciliation();

    expect((await readUser(leaver.id)).deactivatedAt).not.toBeNull();
    const [note] = await testApp.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, testApp.seed.adminUser.id),
          eq(schema.notifications.type, 'user_deactivated_discord'),
        ),
      );
    const row = defined(note, 'admin deactivation notification');
    expect(row.message).toBe(
      'leaver was deactivated by the daily guild sweep (not in the member list).',
    );
    expect(row.payload).toMatchObject({
      deactivatedUserId: leaver.id,
      reason: 'reconciliation-sweep',
    });
  });

  it('stamps every active member in the list and leaves the rest untouched', async () => {
    const oldStamp = new Date('2026-01-01T00:00:00Z');
    const present = await createUser('present', '1749000000000000003');
    const restamped = await createUser('restamped', '1749000000000000004', {
      seen: oldStamp,
    });
    const absentGuest = await createUser('absent', '1749000000000000005');
    const deactivated = await createUser('offline', '1749000000000000006', {
      deactivated: true,
    });
    const local = await createUser('localonly', 'local:localonly@test.local');
    const unlinked = await createUser('unlinkedacct', 'unlinked:1749000007');
    mockGuildMembers([
      '1749000000000000003',
      '1749000000000000004',
      '1749000000000000006',
      'local:localonly@test.local',
      'unlinked:1749000007',
    ]);

    await service.runReconciliation();

    const presentAfter = await readUser(present.id);
    expect(presentAfter.guildMemberSeenAt).not.toBeNull();
    expect(presentAfter.deactivatedAt).toBeNull();
    const restampedAfter = await readUser(restamped.id);
    expect(restampedAfter.guildMemberSeenAt?.getTime()).toBeGreaterThan(
      oldStamp.getTime(),
    );
    expect((await readUser(absentGuest.id)).guildMemberSeenAt).toBeNull();
    expect((await readUser(absentGuest.id)).deactivatedAt).toBeNull();
    expect((await readUser(deactivated.id)).guildMemberSeenAt).toBeNull();
    expect((await readUser(local.id)).guildMemberSeenAt).toBeNull();
    expect((await readUser(unlinked.id)).guildMemberSeenAt).toBeNull();
  });

  // Review ask: pins stamp-BEFORE-candidate-load. For a present member the
  // deactivation outcome is order-independent, but the avatar sync only walks
  // candidates — if stamping ran after loadActiveDbUsers, a first-seen member
  // would not be a candidate on this pass and the avatar would stay stale.
  it('stamps before loading candidates, so a first-seen member is synced in the same pass', async () => {
    const member = await createUser('firstseen', '1749000000000000009');
    await testApp.db
      .update(schema.users)
      .set({ avatar: 'stalehash' })
      .where(eq(schema.users.id, member.id));
    listSpy = jest
      .spyOn(botClient, 'listAllGuildMemberAvatars')
      .mockResolvedValue(new Map([['1749000000000000009', 'freshhash']]));

    await service.runReconciliation();

    const after = await readUser(member.id);
    expect(after.guildMemberSeenAt).not.toBeNull();
    expect(after.deactivatedAt).toBeNull();
    expect(after.avatar).toBe('freshhash');
  });

  it('never makes a local: or unlinked: user a candidate, even when stamped', async () => {
    const seen = new Date('2026-01-01T00:00:00Z');
    const local = await createUser('localseen', 'local:seen@test.local', {
      seen,
    });
    const unlinked = await createUser('unlinkedseen', 'unlinked:1749000008', {
      seen,
    });
    mockGuildMembers([]);

    await service.runReconciliation();

    expect((await readUser(local.id)).deactivatedAt).toBeNull();
    expect((await readUser(unlinked.id)).deactivatedAt).toBeNull();
  });
});
