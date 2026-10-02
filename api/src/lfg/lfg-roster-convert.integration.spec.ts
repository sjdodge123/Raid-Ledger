/**
 * ROK-1625 — landing on an LFG-born session's roster converts the joiner's
 * own hand, and nothing else.
 *
 * Every join is driven through the REAL roster seam
 * (`AdHocParticipantService.addParticipant` → `AD_HOC_EVENTS.PARTICIPANT_JOINED`
 * → `LfgQuickPlayListener`), so the EventEmitter2 subscription itself is under
 * test, not a hand-called handler. The listener's own promise is the
 * completion signal: a reverted line then fails on the outcome assertion that
 * follows, never on a poll timeout, and a "nothing moved" assertion cannot
 * pass merely because the listener had not run yet.
 *
 * Every case carries a MUTATION note naming the listener line to revert.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { createGame } from './lfg.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { AdHocParticipantService } from '../discord-bot/services/ad-hoc-participant.service';
import { LFG_NOW_SPAWN_THRESHOLD } from '../discord-bot/lfg-now/lfg-now.constants';
import { LfgQuickPlayListener } from './lfg-quickplay.listener';
import { findOpenLfgNowEventId } from './lfg-playing.helpers';
import { LFG_EVENTS } from './lfg.constants';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

interface Member {
  userId: number;
  token: string;
  discordId: string;
}

type IntentRow = typeof schema.lfgIntents.$inferSelect;

/** The open LFG-born session `a` started, plus everyone's hands. */
interface Session {
  gameId: number;
  eventId: number;
  a: Member;
  b: Member;
  c: Member;
  /** C's week hand expiry, recorded right after the start. */
  cExpiresAt: Date;
}

async function member(name: string): Promise<Member> {
  const email = `${name}@rosterconvert.test`;
  const m = await createMemberAndLogin(testApp, name, email);
  return { ...m, discordId: `local:${email}` };
}

async function postHand(
  who: Member,
  gameId: number,
  urgency: 'now' | 'week',
): Promise<void> {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${who.token}`)
    .send({ gameId, urgency });
  expect(res.status).toBe(201);
}

const startNow = (token: string, gameId: number) =>
  testApp.request
    .post(`/lfg/${gameId}/start-now`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

const getGroup = (token: string, gameId: number) =>
  testApp.request.get(`/lfg/${gameId}`).set('Authorization', `Bearer ${token}`);

async function liveAdHocEvents(gameId: number) {
  return testApp.db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.gameId, gameId),
        eq(schema.events.isAdHoc, true),
        isNull(schema.events.cancelledAt),
      ),
    );
}

/** Every intent row on the game, in a stable order — the "nothing moved" snapshot. */
async function intentRows(gameId: number): Promise<IntentRow[]> {
  return testApp.db
    .select()
    .from(schema.lfgIntents)
    .where(eq(schema.lfgIntents.gameId, gameId))
    .orderBy(schema.lfgIntents.id);
}

/** The ONE intent row `who` holds on the game (each member posts exactly once). */
async function intentOf(who: Member, gameId: number): Promise<IntentRow> {
  const rows = (await intentRows(gameId)).filter(
    (r) => r.userId === who.userId,
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

/**
 * Join `who` to the roster of `eventId` through the real seam, then await the
 * listener's own run of that payload. The `toHaveBeenCalledWith` is also the
 * AC6 proof: only the `PARTICIPANT_JOINED` subscription can reach it.
 */
async function joinRoster(eventId: number, who: Member): Promise<void> {
  const handler = jest.spyOn(
    testApp.app.get(LfgQuickPlayListener),
    'onParticipantJoined',
  );
  await testApp.app.get(AdHocParticipantService).addParticipant(eventId, {
    discordUserId: who.discordId,
    discordUsername: `u${who.userId}`,
    discordAvatarHash: null,
    userId: who.userId,
  });
  const payload = { eventId, userId: who.userId, discordUserId: who.discordId };
  await waitFor(() =>
    Promise.resolve().then(() => expect(handler).toHaveBeenCalledWith(payload)),
  );
  const idx = handler.mock.calls.findIndex(
    ([p]) => p.eventId === eventId && p.userId === who.userId,
  );
  await handler.mock.results[idx]?.value;
  handler.mockRestore();
}

/**
 * B and C post WEEK hands, A posts a NOW hand (below the spawn threshold, so
 * nothing auto-spawns), then A starts a session on demand: the LFG-born event.
 */
async function startLfgBornSession(name: string): Promise<Session> {
  const { id: gameId } = await createGame(testApp, name);
  const a = await member(`${name}_a`);
  const b = await member(`${name}_b`);
  const c = await member(`${name}_c`);
  await postHand(b, gameId, 'week');
  await postHand(c, gameId, 'week');
  await postHand(a, gameId, 'now');
  expect(LFG_NOW_SPAWN_THRESHOLD).toBeGreaterThan(1);
  expect(await liveAdHocEvents(gameId)).toHaveLength(0);

  const res = await startNow(a.token, gameId);
  expect(res.status).toBe(200);
  const eventId = res.body.eventId as number;
  expect(await findOpenLfgNowEventId(testApp.db, gameId)).toBe(eventId);
  expect(await intentOf(a, gameId)).toMatchObject({
    status: 'converted',
    convertedToEventId: eventId,
  });
  expect((await intentOf(b, gameId)).status).toBe('active');
  const cRow = await intentOf(c, gameId);
  expect(cRow.status).toBe('active');
  return { gameId, eventId, a, b, c, cExpiresAt: cRow.expiresAt };
}

/** A plain Quick Play session on the game: live ad-hoc, NO `lfg_intents` link. */
async function seedQuickPlayEvent(gameId: number, creatorId: number) {
  const now = Date.now();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Quick Play — no LFG provenance',
      creatorId,
      duration: [new Date(now - 5 * 60_000), new Date(now + 55 * 60_000)] as [
        Date,
        Date,
      ],
      gameId,
      isAdHoc: true,
      adHocStatus: 'live',
      channelBindingId: null,
    })
    .returning({ id: schema.events.id });
  return event.id;
}

async function expectStillActive(s: Session): Promise<void> {
  const c = await intentOf(s.c, s.gameId);
  expect({
    status: c.status,
    convertedToEventId: c.convertedToEventId,
  }).toEqual({ status: 'active', convertedToEventId: null });
  expect(c.expiresAt.toISOString()).toBe(s.cExpiresAt.toISOString());
}

describe('LFG-born roster join converts the joiner (integration)', () => {
  it('converts ONLY the joiner; the invitee who never joined keeps her week hand (AC1, AC3)', async () => {
    // MUTATION: delete `if (await this.convertIfLfgBorn(...)) return;` in
    // lfg-quickplay.listener.ts and B's row stays 'active' (AC1).
    // MUTATION: swap the listener's `convertHolderIntent(...)` for
    // `convertGroup(...)` and C's week hand is swept into E as well (AC3).
    const s = await startLfgBornSession('rc_join');

    await joinRoster(s.eventId, s.b);

    const b = await intentOf(s.b, s.gameId);
    expect({
      status: b.status,
      convertedToEventId: b.convertedToEventId,
    }).toEqual({ status: 'converted', convertedToEventId: s.eventId });
    await expectStillActive(s);
    expect(await intentOf(s.a, s.gameId)).toMatchObject({
      status: 'converted',
      convertedToEventId: s.eventId,
    });

    const res = await getGroup(s.c.token, s.gameId);
    expect(res.status).toBe(200);
    const group = res.body as LfgGroupDetailDto;
    expect(group.playingNow?.eventId).toBe(s.eventId);
    // Only C's week hand is still looking: A and B both converted into E.
    expect(group.activeCount).toBe(1);
    expect(group.members.map((m) => m.userId)).toEqual([s.c.userId]);
  });

  it('re-running the handler for an already-converted joiner is a safe no-op (AC4)', async () => {
    // MUTATION: swap the listener's `convertHolderIntent(...)` for
    // `convertGroup(...)` and this second pass sweeps C's still-active week
    // hand into E, so the snapshot below no longer matches.
    const s = await startLfgBornSession('rc_again');
    await joinRoster(s.eventId, s.b);
    const before = await intentRows(s.gameId);

    await expect(
      testApp.app.get(LfgQuickPlayListener).onParticipantJoined({
        eventId: s.eventId,
        userId: s.b.userId,
        discordUserId: s.b.discordId,
      }),
    ).resolves.toBeUndefined();

    expect(await intentRows(s.gameId)).toEqual(before);
    const b = await intentOf(s.b, s.gameId);
    expect(b).toMatchObject({
      status: 'converted',
      convertedToEventId: s.eventId,
    });
    await expectStillActive(s);
  });

  it('a join on a plain Quick Play session for the same game converts nothing (AC2)', async () => {
    // MUTATION: change the listener's
    // `if ((await findOpenLfgNowEventId(this.db, gameId)) !== eventId)` to
    // `=== null` (any open LFG session counts) and C's week hand converts
    // into the Quick Play event.
    const s = await startLfgBornSession('rc_qp');
    const qp = await seedQuickPlayEvent(s.gameId, s.a.userId);
    // QP carries no provenance, so E is still THE game's LFG-born event.
    expect(await findOpenLfgNowEventId(testApp.db, s.gameId)).toBe(s.eventId);
    const emit = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');

    await joinRoster(qp, s.c);

    await expectStillActive(s);
    await waitFor(() =>
      Promise.resolve().then(() =>
        expect(emit).toHaveBeenCalledWith(LFG_EVENTS.QUICK_PLAY_MATCH, {
          userId: s.c.userId,
          gameId: s.gameId,
          eventId: qp,
        }),
      ),
    );
    expect((await intentOf(s.b, s.gameId)).status).toBe('active');
  });
});
