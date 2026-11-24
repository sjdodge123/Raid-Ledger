/**
 * ROK-2306 — `LineupsService.toggleVote` refuses a banned / deactivated
 * account at the service layer (the same `ACCOUNT_BLOCKED` 403 the ROK-2298
 * nominate guard throws), so a caller that bypasses `NotDeactivatedGuard`
 * cannot vote for a blocked user. Real DB; the active control keeps the
 * refusal honest — the same fixture lets an active member's vote land.
 */
import { HttpException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { LineupsService } from './lineups.service';

type Block = 'banned' | 'deactivated' | 'active';
const BLOCKED = { status: 403, code: 'ACCOUNT_BLOCKED' };
const DISCORD_IDS: Record<Block, string> = {
  banned: '230600000000000101',
  deactivated: '230600000000000102',
  active: '230600000000000103',
};

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// No afterAll truncate: the shared app's pool must stay open.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

function lineups(): LineupsService {
  return testApp.app.get(LineupsService, { strict: false });
}

async function createUser(block: Block): Promise<number> {
  const now = new Date();
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: DISCORD_IDS[block],
        username: `rok2306_${block}`,
        role: 'member',
        bannedAt: block === 'banned' ? now : null,
        deactivatedAt: block === 'deactivated' ? now : null,
      })
      .returning(),
    'user',
  );
  return user.id;
}

/** A public lineup in `voting` with one nominated game. */
async function createVotingLineup(): Promise<{
  lineupId: number;
  gameId: number;
}> {
  const res = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'ROK-2306 lineup' });
  if (res.status !== 201) throw new Error(`createLineup failed: ${res.status}`);
  const lineupId = res.body.id as number;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'ROK-2306 Game', slug: `rok-2306-game-${Date.now()}` })
      .returning(),
    'game',
  );
  await testApp.db.insert(schema.communityLineupEntries).values({
    lineupId,
    gameId: game.id,
    nominatedBy: testApp.seed.adminUser.id,
  });
  await testApp.db
    .update(schema.communityLineups)
    .set({ status: 'voting' })
    .where(eq(schema.communityLineups.id, lineupId));
  return { lineupId, gameId: game.id };
}

async function votesBy(lineupId: number, userId: number) {
  return testApp.db
    .select({ gameId: schema.communityLineupVotes.gameId })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.userId, userId),
      ),
    );
}

/** Settle a promise into `{status, code}` — or `'ok'` when it resolved. */
async function outcome(
  p: Promise<unknown>,
): Promise<'ok' | { status: number; code: unknown }> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!(err instanceof HttpException)) throw err;
    const body = err.getResponse();
    const code = typeof body === 'object' && 'code' in body ? body.code : null;
    return { status: err.getStatus(), code };
  }
}

describe('LineupsService.toggleVote refuses blocked accounts (ROK-2306)', () => {
  it.each<Block>(['banned', 'deactivated'])(
    '%s user → 403 ACCOUNT_BLOCKED and no vote row',
    async (block) => {
      const userId = await createUser(block);
      const { lineupId, gameId } = await createVotingLineup();
      const result = await outcome(
        lineups().toggleVote(lineupId, gameId, userId, 'member'),
      );
      expect({ result, rows: await votesBy(lineupId, userId) }).toEqual({
        result: BLOCKED,
        rows: [],
      });
    },
  );

  it('active control: the vote row is written', async () => {
    const userId = await createUser('active');
    const { lineupId, gameId } = await createVotingLineup();
    const result = await outcome(
      lineups().toggleVote(lineupId, gameId, userId, 'member'),
    );
    expect({ result, rows: await votesBy(lineupId, userId) }).toEqual({
      result: 'ok',
      rows: [{ gameId }],
    });
  });
});
