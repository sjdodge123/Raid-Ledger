/**
 * ROK-2298 — banned / deactivated accounts are refused by the service layer
 * for EVERY caller (AC 2), a blocked user's Discord id never produces an
 * anonymous signup (AC 3), and a blocked user can still cancel an existing
 * signup (AC 4). Real DB; active-user controls keep each refusal honest.
 */
import { HttpException } from '@nestjs/common';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { createFutureEvent } from './signups.integration.spec-helpers';
import { SignupsService } from './signups.service';
import { LineupsService } from '../lineups/lineups.service';

const LINKED_DISCORD_ID = '229800000000000101';
const UNLINKED_DISCORD_ID = '229800000000000102';
const TOMBSTONED_DISCORD_ID = '229800000000000103';

type Block = 'banned' | 'deactivated' | 'active';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// No afterAll truncate: the shared app's pool must stay open (memory
// reference_integration_specs_no_aftersall_truncate).
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

function signups(): SignupsService {
  return testApp.app.get(SignupsService, { strict: false });
}

function lineups(): LineupsService {
  return testApp.app.get(LineupsService, { strict: false });
}

async function createUser(block: Block, discordId: string): Promise<number> {
  const now = new Date();
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId,
        username: `rok2298_${block}_${discordId.slice(-4)}`,
        role: 'member',
        bannedAt: block === 'banned' ? now : null,
        deactivatedAt: block === 'deactivated' ? now : null,
      })
      .returning(),
    'user',
  );
  return user.id;
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

const BLOCKED = { status: 403, code: 'ACCOUNT_BLOCKED' };

async function signupRows(eventId: number) {
  return testApp.db
    .select({
      userId: schema.eventSignups.userId,
      discordUserId: schema.eventSignups.discordUserId,
      status: schema.eventSignups.status,
    })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        // POST /events auto-signs the admin creator up; ignore that row.
        or(
          isNull(schema.eventSignups.userId),
          ne(schema.eventSignups.userId, testApp.seed.adminUser.id),
        ),
      ),
    );
}

function discordDto(discordUserId: string) {
  return { discordUserId, discordUsername: 'rok2298-discord-name' };
}

describe('SignupsService.signup refuses blocked accounts (ROK-2298 D3)', () => {
  it.each<Block>(['banned', 'deactivated'])(
    '%s user → 403 ACCOUNT_BLOCKED and no signup row',
    async (block) => {
      const userId = await createUser(block, LINKED_DISCORD_ID);
      const eventId = await createFutureEvent(testApp, adminToken);
      expect({
        result: await outcome(signups().signup(eventId, userId)),
        rows: await signupRows(eventId),
      }).toEqual({ result: BLOCKED, rows: [] });
    },
  );

  it('active control: the user is signed up', async () => {
    const userId = await createUser('active', LINKED_DISCORD_ID);
    const eventId = await createFutureEvent(testApp, adminToken);
    expect(await outcome(signups().signup(eventId, userId))).toBe('ok');
    expect((await signupRows(eventId)).map((r) => r.userId)).toEqual([userId]);
  });
});

describe('signupDiscord never goes anonymous for a blocked id (ROK-2298 D1)', () => {
  it.each<Block>(['banned', 'deactivated'])(
    'linked %s Discord id → 403 and no row, not even an anonymous one',
    async (block) => {
      await createUser(block, LINKED_DISCORD_ID);
      const eventId = await createFutureEvent(testApp, adminToken);
      const result = await outcome(
        signups().signupDiscord(eventId, discordDto(LINKED_DISCORD_ID)),
      );
      // Rows for the event at all — covers user_id AND discord_user_id.
      expect({ result, rows: await signupRows(eventId) }).toEqual({
        result: BLOCKED,
        rows: [],
      });
    },
  );

  it('a banned row tombstoned as unlinked:<id> refuses the raw id (Q3)', async () => {
    await createUser('banned', `unlinked:${TOMBSTONED_DISCORD_ID}`);
    const eventId = await createFutureEvent(testApp, adminToken);
    const result = await outcome(
      signups().signupDiscord(eventId, discordDto(TOMBSTONED_DISCORD_ID)),
    );
    expect({ result, rows: await signupRows(eventId) }).toEqual({
      result: BLOCKED,
      rows: [],
    });
  });

  it('control: an unlinked Discord id still gets an anonymous row', async () => {
    const eventId = await createFutureEvent(testApp, adminToken);
    const result = await outcome(
      signups().signupDiscord(eventId, discordDto(UNLINKED_DISCORD_ID)),
    );
    expect({
      result,
      rows: (await signupRows(eventId)).map((r) => [r.userId, r.discordUserId]),
    }).toEqual({ result: 'ok', rows: [[null, UNLINKED_DISCORD_ID]] });
  });
});

async function createLineupAndGame(): Promise<{
  lineupId: number;
  gameId: number;
}> {
  const res = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'ROK-2298 lineup' });
  if (res.status !== 201) throw new Error(`createLineup failed: ${res.status}`);
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'ROK-2298 Game', slug: `rok-2298-game-${Date.now()}` })
      .returning(),
    'game',
  );
  return { lineupId: res.body.id as number, gameId: game.id };
}

async function nominationsBy(lineupId: number, userId: number) {
  return testApp.db
    .select({ gameId: schema.communityLineupEntries.gameId })
    .from(schema.communityLineupEntries)
    .where(
      and(
        eq(schema.communityLineupEntries.lineupId, lineupId),
        eq(schema.communityLineupEntries.nominatedBy, userId),
      ),
    );
}

describe('LineupsService.nominate refuses blocked accounts (ROK-2298 D4)', () => {
  it.each<Block>(['banned', 'deactivated'])(
    '%s user → 403 ACCOUNT_BLOCKED and no nomination row',
    async (block) => {
      const userId = await createUser(block, LINKED_DISCORD_ID);
      const { lineupId, gameId } = await createLineupAndGame();
      const result = await outcome(
        lineups().nominate(lineupId, { gameId }, userId, 'member'),
      );
      expect({ result, rows: await nominationsBy(lineupId, userId) }).toEqual({
        result: BLOCKED,
        rows: [],
      });
    },
  );

  it('active control: the nomination row is written', async () => {
    const userId = await createUser('active', LINKED_DISCORD_ID);
    const { lineupId, gameId } = await createLineupAndGame();
    const result = await outcome(
      lineups().nominate(lineupId, { gameId }, userId, 'member'),
    );
    expect({ result, rows: await nominationsBy(lineupId, userId) }).toEqual({
      result: 'ok',
      rows: [{ gameId }],
    });
  });
});

describe('a blocked user can still leave an existing signup (ROK-2298 AC 4)', () => {
  it.each<Block>(['banned', 'deactivated'])(
    '%s user cancels via cancelByDiscordUser',
    async (block) => {
      const userId = await createUser('active', LINKED_DISCORD_ID);
      const eventId = await createFutureEvent(testApp, adminToken);
      await signups().signup(eventId, userId);
      const now = new Date();
      await testApp.db
        .update(schema.users)
        .set(block === 'banned' ? { bannedAt: now } : { deactivatedAt: now })
        .where(eq(schema.users.id, userId));
      const result = await outcome(
        signups().cancelByDiscordUser(eventId, LINKED_DISCORD_ID),
      );
      const statuses = (await signupRows(eventId)).map((r) => r.status);
      expect({ result, stillSignedUp: statuses.includes('signed_up') }).toEqual(
        { result: 'ok', stillSignedUp: false },
      );
    },
  );
});
