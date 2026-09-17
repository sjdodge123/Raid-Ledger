/**
 * ROK-1573 — `POST /events` with `lfgGameId` converts the live LFG group.
 *
 * Scenarios S-A1…S-A7 from `planning-artifacts/specs/ROK-1573-1572.md`, with
 * S-A3/S-A7 revised by review P2-2 (a caller whose group is gone gets a 409
 * and no event) and S-A8 pinning the operator ruling (every live member is
 * signed up, whatever their game time).
 *
 * The race under test (S-A2): the creator's signup emits `signup.created`,
 * whose LFG listener clears the creator's `active` intent. Conversion must run
 * first, or the creator stops being a participant and nothing converts. The
 * deterministic ordering proof lives in `event-create-lfg.helpers.spec.ts`
 * (invocation order); here the listener is replayed and awaited so the
 * "still converted, not cleared" read never races a background handler.
 */
import { and, asc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { LfgSignupListener } from './lfg-signup.listener';
import {
  createGame,
  deactivateUser,
  readIntent,
  readIntentsForGame,
  setExpiresAt,
} from './lfg.integration.spec-helpers';

let testApp: TestApp;

const DAY = 24 * 60 * 60 * 1000;
const GROUP_GONE =
  'This group was already scheduled or you are no longer in it.';

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── local helpers ───────────────────────────────────────────────────────────

type Member = { userId: number; token: string };

async function members(...names: string[]): Promise<Member[]> {
  const out: Member[] = [];
  for (const name of names) {
    out.push(await createMemberAndLogin(testApp, name, `${name}@test.local`));
  }
  return out;
}

async function raiseHand(m: Member, gameId: number): Promise<void> {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${m.token}`)
    .send({ gameId });
  expect(res.status).toBe(201);
}

function createEvent(m: Member, body: Record<string, unknown>) {
  const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${m.token}`)
    .send({
      title: 'LFG Night',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      ...body,
    });
}

async function signedUpUserIds(eventId: number): Promise<number[]> {
  const rows = await testApp.db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.status, 'signed_up'),
      ),
    )
    .orderBy(asc(schema.eventSignups.userId));
  return rows.map((r) => r.userId as number);
}

/** Roster rows per signup on the event: `[userId, role][]`, by user id. */
async function rosterByUser(eventId: number): Promise<[number, string][]> {
  const rows = await testApp.db
    .select({
      userId: schema.eventSignups.userId,
      role: schema.rosterAssignments.role,
    })
    .from(schema.eventSignups)
    .innerJoin(
      schema.rosterAssignments,
      eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
    )
    .where(eq(schema.eventSignups.eventId, eventId))
    .orderBy(asc(schema.eventSignups.userId));
  return rows.map((r) => [r.userId as number, r.role as string]);
}

async function countEvents(): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.events.id })
    .from(schema.events);
  return rows.length;
}

/** Replay the signup listener for the creator and AWAIT it (S-A2). */
async function settleCreatorListener(
  eventId: number,
  userId: number,
): Promise<void> {
  const listener = testApp.app.get(LfgSignupListener);
  await listener.onSignupCreated({ eventId, userId } as Parameters<
    LfgSignupListener['onSignupCreated']
  >[0]);
}

function sorted(ids: number[]): number[] {
  return [...ids].sort((x, y) => x - y);
}

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('POST /events with lfgGameId (ROK-1573)', () => {
  it('S-A1: converts every live intent to the event and signs members up', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Convert Game');
    await raiseHand(a, game.id);
    await raiseHand(b, game.id);

    const res = await createEvent(a, { gameId: game.id, lfgGameId: game.id });

    expect(res.status).toBe(201);
    const eventId = (res.body as { id: number }).id;
    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('converted');
      expect(row.converted_to_event_id).toBe(eventId);
      expect(row.converted_to_poll_id).toBeNull();
    }
    await waitFor(async () => {
      expect(await signedUpUserIds(eventId)).toEqual(
        sorted([a.userId, b.userId]),
      );
    }, 5000);
  });

  it("S-A2: the creator's intent stays converted after the signup listener runs", async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Race Game');
    await raiseHand(a, game.id);
    await raiseHand(b, game.id);

    const res = await createEvent(a, { gameId: game.id, lfgGameId: game.id });
    expect(res.status).toBe(201);
    const eventId = (res.body as { id: number }).id;

    await settleCreatorListener(eventId, a.userId);

    const own = await readIntent(testApp, a.userId, game.id);
    expect(own?.status).toBe('converted');
    expect(own?.converted_to_event_id).toBe(eventId);
  });

  it('S-A3: a non-participant is a 409 and creates no event', async () => {
    const [a, b, c] = await members('alpha', 'bravo', 'charlie');
    const game = await createGame(testApp, 'Outsider Game');
    await raiseHand(a, game.id);
    await raiseHand(b, game.id);
    const before = await countEvents();

    const res = await createEvent(c, { gameId: game.id, lfgGameId: game.id });

    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toBe(GROUP_GONE);
    expect(await countEvents()).toBe(before);
    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows.map((r) => r.status)).toEqual(['active', 'active']);
  });

  it('S-A4: lfgGameId that does not match gameId is a 400 and creates no event', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Game G');
    const other = await createGame(testApp, 'Game H');
    await raiseHand(a, game.id);
    const before = await countEvents();

    const res = await createEvent(a, { gameId: other.id, lfgGameId: game.id });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('lfgGameId');
    expect(await countEvents()).toBe(before);
    expect((await readIntent(testApp, a.userId, game.id))?.status).toBe(
      'active',
    );
  });

  it('S-A5: without lfgGameId behaviour is unchanged (creator cleared, B active)', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Plain Game');
    await raiseHand(a, game.id);
    await raiseHand(b, game.id);

    const res = await createEvent(a, { gameId: game.id });

    expect(res.status).toBe(201);
    await waitFor(async () => {
      const own = await readIntent(testApp, a.userId, game.id);
      expect(own?.status).toBe('cleared');
    }, 5000);
    expect((await readIntent(testApp, b.userId, game.id))?.status).toBe(
      'active',
    );
  });

  it('S-A6: an expired or deactivated member is neither converted nor signed up', async () => {
    const [a, b, d] = await members('alpha', 'bravo', 'delta');
    const game = await createGame(testApp, 'Stale Game');
    await raiseHand(a, game.id);
    await raiseHand(b, game.id);
    await raiseHand(d, game.id);
    const bRow = await readIntent(testApp, b.userId, game.id);
    await setExpiresAt(testApp, bRow!.id, new Date(Date.now() - 60_000));
    await deactivateUser(testApp, d.userId);

    const res = await createEvent(a, { gameId: game.id, lfgGameId: game.id });

    expect(res.status).toBe(201);
    const eventId = (res.body as { id: number }).id;
    expect((await readIntent(testApp, b.userId, game.id))?.status).toBe(
      'active',
    );
    expect((await readIntent(testApp, d.userId, game.id))?.status).toBe(
      'active',
    );
    await settleCreatorListener(eventId, a.userId);
    expect(await signedUpUserIds(eventId)).toEqual([a.userId]);
  });

  it('S-A7: concurrent Lock-ins — one 201, the other 409, exactly one event', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Twice Game');
    await raiseHand(a, game.id);
    await raiseHand(b, game.id);
    const before = await countEvents();

    const [resA, resB] = await Promise.all([
      createEvent(a, { gameId: game.id, lfgGameId: game.id }),
      createEvent(b, { gameId: game.id, lfgGameId: game.id }),
    ]);

    expect([resA.status, resB.status].sort()).toEqual([201, 409]);
    const [winner, loser] = resA.status === 201 ? [resA, resB] : [resB, resA];
    expect((loser.body as { message: string }).message).toBe(GROUP_GONE);
    expect(await countEvents()).toBe(before + 1);
    const eventId = (winner.body as { id: number }).id;
    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows.map((r) => r.converted_to_event_id)).toEqual([
      eventId,
      eventId,
    ]);
    expect(await signedUpUserIds(eventId)).toEqual(
      sorted([a.userId, b.userId]),
    );
  });

  it('S-A8: a live member whose game time misses the window is still signed up', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Busy Game');
    await raiseHand(a, game.id);
    await raiseHand(b, game.id);
    // Event is ~2 days out (createEvent); B's only slot is 3 days off that.
    const eventDay = (new Date(Date.now() + 2 * DAY).getUTCDay() + 6) % 7;
    await testApp.db.insert(schema.gameTimeTemplates).values({
      userId: b.userId,
      dayOfWeek: (eventDay + 3) % 7,
      startHour: 3,
    });

    const res = await createEvent(a, { gameId: game.id, lfgGameId: game.id });

    expect(res.status).toBe(201);
    const eventId = (res.body as { id: number }).id;
    await waitFor(async () => {
      expect(await signedUpUserIds(eventId)).toEqual(
        sorted([a.userId, b.userId]),
      );
    }, 5000);
  });

  it('S-A9: every Lock-in signup is rostered as a player, the creator once', async () => {
    const [a, b, c] = await members('alpha', 'bravo', 'charlie');
    const game = await createGame(testApp, 'Roster Game');
    for (const m of [a, b, c]) await raiseHand(m, game.id);

    const res = await createEvent(a, { gameId: game.id, lfgGameId: game.id });

    expect(res.status).toBe(201);
    const eventId = (res.body as { id: number }).id;
    const everyone = sorted([a.userId, b.userId, c.userId]);
    expect(await signedUpUserIds(eventId)).toEqual(everyone);
    expect(await rosterByUser(eventId)).toEqual(
      everyone.map((id) => [id, 'player']),
    );
    const [event] = await testApp.db
      .select({ slotConfig: schema.events.slotConfig })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    expect(event.slotConfig).toEqual({ type: 'generic', player: 10 });
  });
});
