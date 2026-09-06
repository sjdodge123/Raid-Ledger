/**
 * ROK-1494 — the "playing now" spawn, against a real DB and the real emitter.
 *
 * AC1 / AC4 / AC5 / AC6 / AC9. The positive cases drive the WHOLE path —
 * `POST /lfg` → the real `LFM_REACHED` / `GROUP_CHANGED` emit → the
 * `@OnEvent` subscriber → the spawn transaction — because the wiring is the
 * part a helper-level spec cannot see.
 *
 * DETERMINISM, and why the negative cases look different from the positive
 * ones: `@OnEvent` handlers are fire-and-forget (the emit is not awaited), so
 * asserting "no event row" immediately after a request would pass while the
 * spawn was still in flight — a vacuous green. Every negative case therefore
 * captures the REAL payload the write side emitted and feeds it back through
 * the subscriber with an `await`, so "no event" is an observed DECISION rather
 * than a race the test happened to win. Positive cases poll with `waitFor`,
 * which rethrows the last assertion error, so a broken wiring fails on
 * `expect(received).toBe(1)` and not on a bare timeout.
 *
 * Each case carries a MUTATION note naming the single line to revert.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import {
  LFG_EXPIRY_JOB_NAME,
  createGame,
  setExpiresAt,
  readIntent,
  type LfgIntentResponseDto,
} from '../../lfg/lfg.integration.spec-helpers';
import { LFG_EVENTS, type LfgLfmReachedPayload } from '../../lfg/lfg.constants';
import * as schema from '../../drizzle/schema';
import { AdHocParticipantService } from '../services/ad-hoc-participant.service';
import { LfgNowSpawnService } from './lfg-now-spawn.service';
import { recordLfgNowVoiceJoin } from './lfg-now-voice.helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── fixtures + request wrappers ─────────────────────────────────────────────

interface Member {
  userId: number;
  token: string;
  /** `createMemberAndLogin` stamps `local:<email>`; the roster is keyed by it. */
  discordId: string;
}

/** Create N logged-in members, in the order the host pick depends on. */
async function members(...names: string[]): Promise<Member[]> {
  const out: Member[] = [];
  for (const name of names) {
    const email = `${name}@lfgnow.test`;
    const m = await createMemberAndLogin(testApp, name, email);
    out.push({ ...m, discordId: `local:${email}` });
  }
  return out;
}

function postIntent(token: string, gameId: number, extra: object = {}) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId, ...extra });
}

const postNow = (token: string, gameId: number) =>
  postIntent(token, gameId, { urgency: 'now', ttlMinutes: 60 });

const postWeek = (token: string, gameId: number) =>
  postIntent(token, gameId, { urgency: 'week' });

// ─── readers ─────────────────────────────────────────────────────────────────

/** Every LFG-born event on a game: ad-hoc, live, never cancelled. */
async function adHocEvents(gameId: number) {
  return testApp.db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.gameId, gameId),
        eq(schema.events.isAdHoc, true),
        isNull(schema.events.cancelledAt),
      ),
    );
}

async function countAdHocEvents(gameId: number): Promise<number> {
  return (await adHocEvents(gameId)).length;
}

/** Roster: `event_signups` rows, by the Discord id `autoSignupParticipant` keys on. */
async function rosterDiscordIds(eventId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ discordUserId: schema.eventSignups.discordUserId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return rows.map((r) => r.discordUserId ?? '').sort();
}

/** AC4's guard, counted server-side so a partial read cannot pass it. */
async function countIntents(gameId: number): Promise<number> {
  const rows = await testApp.db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM lfg_intents WHERE game_id = ${gameId}`,
  );
  return Number(rows[0]?.count ?? '0');
}

async function adHocParticipants(eventId: number) {
  return testApp.db
    .select()
    .from(schema.adHocParticipants)
    .where(eq(schema.adHocParticipants.eventId, eventId));
}

// ─── seams ───────────────────────────────────────────────────────────────────

function spawnService(): LfgNowSpawnService {
  return testApp.app.get(LfgNowSpawnService);
}

/**
 * Force ONE fully-awaited spawn decision on a game, through the real
 * subscriber. Used two ways: as a settle after a positive case (a second pass
 * must ATTACH, never mint), and as the most favourable path available in a
 * negative case — if it still mints nothing, nothing was going to.
 */
async function forceDecision(gameId: number): Promise<void> {
  await spawnService().onGroupChanged({ gameId, reason: 'joined' });
}

/** Capture the real LFM_REACHED payloads emitted while `run` executes. */
async function captureLfm(
  run: () => Promise<void>,
): Promise<LfgLfmReachedPayload[]> {
  const emitter = testApp.app.get(EventEmitter2);
  const seen: LfgLfmReachedPayload[] = [];
  const onReached = (payload: LfgLfmReachedPayload): void => {
    seen.push(payload);
  };
  emitter.on(LFG_EVENTS.LFM_REACHED, onReached);
  try {
    await run();
  } finally {
    emitter.off(LFG_EVENTS.LFM_REACHED, onReached);
  }
  return seen;
}

/** Run the expiry sweep for real, through the registered cron job. */
async function fireSweep(): Promise<void> {
  const scheduler = testApp.app.get(SchedulerRegistry, { strict: false });
  await scheduler.getCronJob(LFG_EXPIRY_JOB_NAME).fireOnTick();
}

/** Two now-hands on a fresh game → the spawned event, once it exists. */
async function spawnPair(name: string) {
  const [a, b] = await members('alpha', 'beta');
  const game = await createGame(testApp, name);
  await postNow(a.token, game.id).expect(201);
  await postNow(b.token, game.id).expect(201);
  await waitFor(async () => {
    expect(await countAdHocEvents(game.id)).toBe(1);
  });
  const [event] = await adHocEvents(game.id);
  return { a, b, game, event };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — one event, one host, both hands converted
// ═══════════════════════════════════════════════════════════════════════════

describe('AC1 — two now-hands spawn exactly one session', () => {
  // MUTATION: delete the `@OnEvent(LFG_EVENTS.LFM_REACHED)` decorator on
  // `LfgNowSpawnService.onLfmReached` and this fails inside `waitFor` on
  // `expect(received).toBe(1)` — received 0 — which is `waitFor` rethrowing
  // the last assertion error, not a bare timeout.
  it('mints one ad-hoc event hosted by the EARLIEST hand, rosters both', async () => {
    const { a, b, game, event } = await spawnPair('Helldivers');

    // A second, fully-awaited decision pass must attach, never mint again.
    await forceDecision(game.id);
    expect(await countAdHocEvents(game.id)).toBe(1);

    expect(event.isAdHoc).toBe(true);
    // The provenance discriminator (D7): an LFG-born event has no binding.
    expect(event.channelBindingId).toBeNull();
    expect(event.adHocStatus).toBe('live');
    expect(event.creatorId).toBe(a.userId);
    expect(await rosterDiscordIds(event.id)).toEqual(
      [a.discordId, b.discordId].sort(),
    );
  });

  // MUTATION: delete `await convertGroup(tx, gameId, { eventId })` from
  // `spawnUnderGroupLock` (lfg-now-spawn.helpers.ts) and this fails on
  // `expect(received).toBe('converted')` — received 'active'.
  it('converts both intents against the event it just made', async () => {
    const { a, b, game, event } = await spawnPair('Deep Rock');

    for (const m of [a, b]) {
      const row = await readIntent(testApp, m.userId, game.id);
      expect(row?.status).toBe('converted');
      expect(row?.converted_to_event_id).toBe(event.id);
    }
  });

  // MUTATION: delete `if (open !== null) return attachToOpenEvent(tx, ...)`
  // from `spawnUnderGroupLock` and this fails on
  // `expect(received).toBe(<eventId>)` — received null — because with the
  // attach branch gone a lone late hand is below the threshold and its intent
  // is never converted at all.
  it('attaches a third hand to the open session instead of minting a second', async () => {
    const { game, event } = await spawnPair('Left 4 Dead');
    const [c] = await members('gamma');

    await postNow(c.token, game.id).expect(201);

    await waitFor(async () => {
      const row = await readIntent(testApp, c.userId, game.id);
      expect(row?.converted_to_event_id).toBe(event.id);
    });
    expect(await countAdHocEvents(game.id)).toBe(1);
  });

  // AC9's concurrency half.
  // MUTATION: delete the `SELECT pg_advisory_xact_lock(hashtext(...))` line
  // from `spawnUnderGroupLock` and this fails on the ROW COUNT —
  // `expect(received).toBe(1)`, received 2 — because both passes read
  // `open === null` and both mint. It must NOT fail by timeout.
  it('mints one event when the second and third hands land concurrently', async () => {
    const [a, b, c] = await members('alpha', 'beta', 'gamma');
    const game = await createGame(testApp, 'Vermintide');
    await postNow(a.token, game.id).expect(201);

    await Promise.all([
      postNow(b.token, game.id).expect(201),
      postNow(c.token, game.id).expect(201),
    ]);

    await waitFor(async () => {
      for (const m of [a, b, c]) {
        const row = await readIntent(testApp, m.userId, game.id);
        expect(row?.status).toBe('converted');
      }
    });
    await forceDecision(game.id);
    const events = await adHocEvents(game.id);
    expect(events).toHaveLength(1);
    for (const m of [a, b, c]) {
      const row = await readIntent(testApp, m.userId, game.id);
      expect(row?.converted_to_event_id).toBe(events[0].id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5 — a mixed group does not spawn; the LFM post still forms
// ═══════════════════════════════════════════════════════════════════════════

describe('AC5 — 1 week + 1 now', () => {
  // MUTATION: drop `eq(schema.lfgIntents.urgency, 'now')` from
  // `listLiveNowHands` (lfg-now-spawn.helpers.ts) — the week hand then counts
  // toward the threshold, against operator ruling Q1 — and this fails on
  // `expect(received).toBe(0)`, received 1.
  it('forms the LFM group but spawns NO event', async () => {
    const [a, b] = await members('alpha', 'beta');
    const game = await createGame(testApp, 'Valheim');
    await postWeek(a.token, game.id).expect(201);

    const seen = await captureLfm(async () => {
      await postNow(b.token, game.id).expect(201);
    });

    // ROK-1479 is unchanged: the pair still announces itself as an LFM group.
    expect(seen).toHaveLength(1);
    expect(seen[0].gameId).toBe(game.id);
    expect(seen[0].activeCount).toBe(2);
    // Feed the REAL payload back through the subscriber, awaited, so the
    // absence below is a decision rather than a race.
    await spawnService().onLfmReached(seen[0]);
    expect(await countAdHocEvents(game.id)).toBe(0);
  });

  // MUTATION: remove `'joined'` from `SPAWN_REASONS`
  // (lfg-now-spawn.service.ts) and this fails on `expect(received).toBe(1)`,
  // received 0 — which is what proves the GROUP_CHANGED branch is
  // load-bearing: at three total the write side emits GROUP_CHANGED and never
  // LFM_REACHED, so without it this group could never spawn.
  it('spawns once a SECOND now-hand arrives, via GROUP_CHANGED{joined}', async () => {
    const [a, b, c] = await members('alpha', 'beta', 'gamma');
    const game = await createGame(testApp, 'Grounded');
    await postWeek(a.token, game.id).expect(201);
    await postNow(b.token, game.id).expect(201);

    const seen = await captureLfm(async () => {
      await postNow(c.token, game.id).expect(201);
    });

    expect(seen).toHaveLength(0);
    await waitFor(async () => {
      expect(await countAdHocEvents(game.id)).toBe(1);
    });
    const [event] = await adHocEvents(game.id);
    // The week hand is not on the roster it never asked to join.
    expect(await rosterDiscordIds(event.id)).toEqual(
      [b.discordId, c.discordId].sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC6 — a lone hand expires and nothing spawns
// ═══════════════════════════════════════════════════════════════════════════

describe('AC6 — expiry', () => {
  // MUTATION 1 (the live half): change `LFG_NOW_SPAWN_THRESHOLD` from 2 to 1
  // in lfg-now.constants.ts and the FIRST assertion fails on
  // `expect(received).toBe(0)`, received 1.
  // MUTATION 2 (the swept half): replace `expireStaleIntents`'s
  // `expires_at <= now()` predicate with a 14-day literal and the status
  // assertion fails on `expect(received).toBe('expired')`, received 'active'.
  it('never spawns for one hand, and still nothing after the sweep expires it', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Subnautica');
    const res = await postNow(a.token, game.id).expect(201);
    const intent = res.body as LfgIntentResponseDto;

    // Live, but alone: the most favourable decision pass mints nothing.
    await forceDecision(game.id);
    expect(await countAdHocEvents(game.id)).toBe(0);

    await setExpiresAt(testApp, intent.id, new Date(Date.now() - 60_000));
    await fireSweep();

    const row = await readIntent(testApp, a.userId, game.id);
    expect(row?.status).toBe('expired');
    expect(row?.converted_to_event_id).toBeNull();
    await forceDecision(game.id);
    expect(await countAdHocEvents(game.id)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — voice joiners are the roster, and write NO intents
// ═══════════════════════════════════════════════════════════════════════════

describe('AC4 — a voice join creates no lfg_intents row', () => {
  // MUTATION: delete `await deps.participantService.addParticipant(...)` from
  // `recordLfgNowVoiceJoin` (lfg-now-voice.helpers.ts) and this fails on
  // `expect(received).toHaveLength(1)`, received 0 — i.e. the A3 route is
  // genuinely being driven here, so the intent-count assertion below is a
  // real invariant and not an assertion about nothing.
  it('records an unlinked joiner on the roster, leaving the intent count exact', async () => {
    const { game, event } = await spawnPair('Barotrauma');
    await testApp.db
      .update(schema.events)
      .set({ ephemeralVoiceChannelId: 'vc-1494' })
      .where(eq(schema.events.id, event.id));
    const before = await countIntents(game.id);
    expect(before).toBe(2);

    const recorded = await recordLfgNowVoiceJoin(
      {
        db: testApp.db,
        participantService: testApp.app.get(AdHocParticipantService),
      },
      'vc-1494',
      {
        discordUserId: 'discord-guest-1494',
        discordUsername: 'guest',
        discordAvatarHash: null,
      },
    );

    expect(recorded).toBe(event.id);
    const roster = await adHocParticipants(event.id);
    expect(roster).toHaveLength(1);
    // Q3: an unlinked joiner counts by Discord name, never as an app user.
    expect(roster[0].userId).toBeNull();
    expect(roster[0].discordUserId).toBe('discord-guest-1494');
    expect(await countIntents(game.id)).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC9 — weekly groups are untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('AC9 — two week-hands', () => {
  // MUTATION: drop `eq(schema.lfgIntents.urgency, 'now')` from
  // `listLiveNowHands` and this fails on `expect(received).toBe(0)`,
  // received 1 — the weekly path would start minting sessions nobody asked
  // for, which is the regression this invariant exists to catch.
  it('reach LFM and spawn nothing at all', async () => {
    const [a, b] = await members('alpha', 'beta');
    const game = await createGame(testApp, 'Factorio');
    await postWeek(a.token, game.id).expect(201);

    const seen = await captureLfm(async () => {
      await postWeek(b.token, game.id).expect(201);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].urgency).toBe('week');
    await spawnService().onLfmReached(seen[0]);
    await forceDecision(game.id);
    expect(await countAdHocEvents(game.id)).toBe(0);
    const row = await readIntent(testApp, a.userId, game.id);
    expect(row?.status).toBe('active');
  });
});
