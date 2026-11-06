/**
 * LFG write paths refuse admin-hidden and banned games (2026-10-18 security
 * review, TECH-DEBT-BACKLOG "LFG write paths accept admin-hidden/banned
 * games").
 *
 * `requireGame` matched on id only, so `POST /lfg`, `POST /lfg/:gameId/invites`
 * and `POST /lfg/:gameId/convert` happily wrote against a moderated game. The
 * write paths now go through `requireVisibleGame`, which 404s a hidden or
 * banned game with the SAME "Game not found" a missing id gets — a moderated
 * game must be indistinguishable from one that does not exist.
 *
 * Every case asserts the 'Game not found' body, which distinguishes this 404
 * from an unmounted route's. The `POST /lfg` cases also pair the refusal with a
 * positive control on the same route; the invite and convert cases instead
 * prove the group formed (a 201 `POST /lfg`) before the game was moderated.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { createFutureEvent } from '../events/signups.integration.spec-helpers';
import {
  createGame,
  createMembers,
  readIntent,
} from './lfg.integration.spec-helpers';

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

function postIntent(token: string, gameId: number) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

function invite(token: string, gameId: number, userId: number) {
  return testApp.request
    .post(`/lfg/${gameId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ userId });
}

function convert(token: string, gameId: number, body: object) {
  return testApp.request
    .post(`/lfg/${gameId}/convert`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** Moderate a game after the fact, as an admin hiding or banning it would. */
async function moderate(
  gameId: number,
  flags: Partial<Pick<typeof schema.games.$inferInsert, 'hidden' | 'banned'>>,
): Promise<void> {
  await testApp.db
    .update(schema.games)
    .set(flags)
    .where(eq(schema.games.id, gameId));
}

describe('POST /lfg — moderated games', () => {
  it.each([
    ['hidden', { hidden: true }],
    ['banned', { banned: true }],
  ] as const)(
    '404s a %s game exactly like a missing one and writes no intent',
    async (_label, flags) => {
      const [a] = await members('alpha');
      const visible = await createGame(testApp, 'Visible Game');
      expect((await postIntent(a.token, visible.id)).status).toBe(201);
      const moderated = await createGame(testApp, 'Moderated Game', flags);

      const res = await postIntent(a.token, moderated.id);

      expect(res.status).toBe(404);
      expect((res.body as { message?: unknown }).message).toBe(
        'Game not found',
      );
      expect(await readIntent(testApp, a.userId, moderated.id)).toBeNull();
    },
  );
});

describe('POST /lfg/:gameId/invites — moderated games', () => {
  it('404s an invite into a group whose game was hidden after it formed', async () => {
    const [host, guest] = await members('host', 'guest');
    const game = await createGame(testApp, 'Later Hidden Game');
    expect((await postIntent(host.token, game.id)).status).toBe(201);
    await moderate(game.id, { hidden: true });

    const res = await invite(host.token, game.id, guest.userId);

    expect(res.status).toBe(404);
    expect((res.body as { message?: unknown }).message).toBe('Game not found');
  });
});

describe('POST /lfg/:gameId/convert — moderated games', () => {
  it('404s converting a group whose game was banned and leaves the intent live', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Later Banned Game');
    expect((await postIntent(a.token, game.id)).status).toBe(201);
    const eventId = await createFutureEvent(testApp, adminToken, {
      gameId: game.id,
    });
    await moderate(game.id, { banned: true });

    const res = await convert(a.token, game.id, { eventId });

    expect(res.status).toBe(404);
    expect((res.body as { message?: unknown }).message).toBe('Game not found');
    expect((await readIntent(testApp, a.userId, game.id))?.status).toBe(
      'active',
    );
  });
});

/** Logged-in members, one per name, as a positional tuple. */
function members<N extends string[]>(...names: N) {
  return createMembers(testApp, ...names);
}
