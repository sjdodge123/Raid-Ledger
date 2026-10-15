/**
 * ROK-1767 — `findDesiredMembers` against a real DB: presence sessions inside
 * and outside the window, scheduled-event voice attendance (no_show and
 * zero-time rows excluded), opt-out, deactivated users and other games.
 */
import { GAME_ROLES_OPT_OUT_PREF_KEY } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { findDesiredMembers } from './game-role-desired.helpers';

const NOW = new Date('2026-10-15T12:00:00Z');
const daysAgo = (d: number): Date => new Date(NOW.getTime() - d * 86_400_000);

let testApp: TestApp;
let gameId: number;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  gameId = testApp.seed.game.id;
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function makeUser(
  opts: { deactivated?: boolean; discordId?: string } = {},
): Promise<{ id: number; discordId: string }> {
  seq += 1;
  const discordId = opts.discordId ?? `90000000000000${seq}`;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId,
        username: `gr-user-${seq}`,
        role: 'member',
        deactivatedAt: opts.deactivated ? daysAgo(1) : null,
      })
      .returning(),
    'user',
  );
  return { id: u.id, discordId };
}

async function makeGame(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        igdbId: null,
      })
      .returning(),
    'game',
  );
  return g.id;
}

async function presence(
  userId: number,
  gid: number,
  startedAt: Date,
): Promise<void> {
  await testApp.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId: gid,
    discordActivityName: 'Some Game',
    startedAt,
    endedAt: new Date(startedAt.getTime() + 3_600_000),
    durationSeconds: 3600,
  });
}

async function attended(
  user: { id: number; discordId: string },
  o: {
    leftAt: Date | null;
    seconds: number;
    classification: string | null;
    /** false = a start-of-event voice snapshot row (user_id NULL). */
    linked?: boolean;
    window?: [Date, Date];
  },
): Promise<void> {
  const [ev] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `GR Raid ${++seq}`,
        creatorId: testApp.seed.adminUser.id,
        gameId,
        duration: o.window ?? ([daysAgo(3), daysAgo(2.9)] as [Date, Date]),
      })
      .returning(),
    'event',
  );
  await testApp.db.insert(schema.eventVoiceSessions).values({
    eventId: ev.id,
    userId: o.linked === false ? null : user.id,
    discordUserId: user.discordId,
    discordUsername: 'voice-user',
    firstJoinAt: daysAgo(3),
    lastLeaveAt: o.leftAt,
    totalDurationSec: o.seconds,
    classification: o.classification,
  });
}

/** A Quick Play (ad-hoc) session of `gid` that `user` took part in. */
async function quickPlayed(
  user: { id: number; discordId: string },
  o: {
    gid?: number;
    leftAt: Date | null;
    seconds: number | null;
    window: [Date, Date];
    /** false = an unlinked participant row (user_id NULL). */
    linked?: boolean;
  },
): Promise<void> {
  const [ev] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `GR Quick Play ${++seq}`,
        creatorId: testApp.seed.adminUser.id,
        gameId: o.gid ?? gameId,
        duration: o.window,
        isAdHoc: true,
        adHocStatus: 'ended',
      })
      .returning(),
    'quick play event',
  );
  await testApp.db.insert(schema.adHocParticipants).values({
    eventId: ev.id,
    userId: o.linked === false ? null : user.id,
    discordUserId: user.discordId,
    discordUsername: 'qp-user',
    joinedAt: o.window[0],
    leftAt: o.leftAt,
    totalDurationSeconds: o.seconds,
  });
}

const desired = () => findDesiredMembers(testApp.db, gameId, 14, NOW);

describe('findDesiredMembers window and sources (ROK-1767)', () => {
  it('counts a presence session inside the window and ignores one outside it', async () => {
    const recent = await makeUser();
    const stale = await makeUser();
    await presence(recent.id, gameId, daysAgo(2));
    await presence(stale.id, gameId, daysAgo(20));

    const map = await desired();

    expect([...map.keys()]).toEqual([recent.id]);
    expect(map.get(recent.id)?.discordUserId).toBe(recent.discordId);
    expect(map.get(recent.id)?.lastPlayedAt.toISOString()).toBe(
      daysAgo(2).toISOString(),
    );
  });

  it('takes the latest play across presence and event voice attendance', async () => {
    const u = await makeUser();
    await presence(u.id, gameId, daysAgo(10));
    await attended(u, {
      leftAt: daysAgo(1),
      seconds: 1800,
      classification: 'full',
    });

    const map = await desired();

    expect(map.get(u.id)?.lastPlayedAt.toISOString()).toBe(
      daysAgo(1).toISOString(),
    );
  });

  it('counts a member still in voice, but not a no_show or a zero-time row', async () => {
    const inVoice = await makeUser();
    const noShow = await makeUser();
    const zero = await makeUser();
    // The event is still running, so "still in voice" plays at `now`.
    await attended(inVoice, {
      leftAt: null,
      seconds: 0,
      classification: null,
      window: [daysAgo(0.1), daysAgo(-0.1)],
    });
    await attended(noShow, {
      leftAt: daysAgo(1),
      seconds: 600,
      classification: 'no_show',
    });
    await attended(zero, {
      leftAt: daysAgo(1),
      seconds: 0,
      classification: null,
    });

    const map = await desired();

    expect([...map.keys()]).toEqual([inVoice.id]);
    expect(map.get(inVoice.id)?.lastPlayedAt.toISOString()).toBe(
      NOW.toISOString(),
    );
  });
});

describe('findDesiredMembers voice edge cases (ROK-1767 Codex)', () => {
  it('resolves a snapshot voice row (user_id NULL) through discord_user_id', async () => {
    const u = await makeUser();
    await attended(u, {
      leftAt: daysAgo(1),
      seconds: 1800,
      classification: 'full',
      linked: false,
    });

    const map = await desired();

    expect([...map.keys()]).toEqual([u.id]);
    expect(map.get(u.id)?.discordUserId).toBe(u.discordId);
  });

  it('caps a never-closed voice row at the event end, not now', async () => {
    const recentEnd = await makeUser();
    const longAgo = await makeUser();
    await attended(recentEnd, {
      leftAt: null,
      seconds: 1800,
      classification: null,
    });
    await attended(longAgo, {
      leftAt: null,
      seconds: 1800,
      classification: null,
      window: [daysAgo(30), daysAgo(29.9)],
    });

    const map = await desired();

    expect([...map.keys()]).toEqual([recentEnd.id]);
    expect(map.get(recentEnd.id)?.lastPlayedAt.toISOString()).toBe(
      daysAgo(2.9).toISOString(),
    );
  });
});

describe('findDesiredMembers exclusions (ROK-1767)', () => {
  it('excludes opted-out, deactivated and non-snowflake users', async () => {
    const optedOut = await makeUser();
    const deactivated = await makeUser({ deactivated: true });
    const local = await makeUser({ discordId: 'local:someone' });
    const keeper = await makeUser();
    for (const u of [optedOut, deactivated, local, keeper]) {
      await presence(u.id, gameId, daysAgo(1));
    }
    await testApp.db.insert(schema.userPreferences).values({
      userId: optedOut.id,
      key: GAME_ROLES_OPT_OUT_PREF_KEY,
      value: true,
    });

    const map = await desired();

    expect([...map.keys()]).toEqual([keeper.id]);
  });

  it("ignores another game's sessions", async () => {
    const other = await makeGame('Other GR Game');
    const u = await makeUser();
    await presence(u.id, other, daysAgo(1));

    const map = await desired();

    expect(map.size).toBe(0);
  });
});

describe('findDesiredMembers Quick Play participation (ROK-1767, ruling 2026-10-15)', () => {
  const qpWindow = (d: number): [Date, Date] => [daysAgo(d + 0.1), daysAgo(d)];

  it('counts a non-sharing member who played a Quick Play of the game for 20 minutes', async () => {
    const linked = await makeUser();
    const unlinked = await makeUser();
    await quickPlayed(linked, {
      leftAt: daysAgo(3),
      seconds: 1200,
      window: qpWindow(3),
    });
    await quickPlayed(unlinked, {
      leftAt: daysAgo(2),
      seconds: 1200,
      window: qpWindow(2),
      linked: false,
    });

    const map = await desired();

    expect([...map.keys()].sort((a, b) => a - b)).toEqual(
      [linked.id, unlinked.id].sort((a, b) => a - b),
    );
    expect(map.get(linked.id)?.lastPlayedAt.toISOString()).toBe(
      daysAgo(3).toISOString(),
    );
    expect(map.get(unlinked.id)?.discordUserId).toBe(unlinked.discordId);
  });

  it('ignores a zero-time participant, another game and a session older than the window', async () => {
    const zero = await makeUser();
    const otherGame = await makeUser();
    const stale = await makeUser();
    const other = await makeGame('Other QP Game');
    await quickPlayed(zero, {
      leftAt: daysAgo(1),
      seconds: 0,
      window: qpWindow(1),
    });
    await quickPlayed(otherGame, {
      gid: other,
      leftAt: daysAgo(1),
      seconds: 1200,
      window: qpWindow(1),
    });
    await quickPlayed(stale, {
      leftAt: daysAgo(20),
      seconds: 1200,
      window: qpWindow(20),
    });

    const map = await desired();

    expect([...map.keys()]).toEqual([]);
  });

  it('caps a never-closed participant row at the Quick Play end, not now', async () => {
    const open = await makeUser();
    await quickPlayed(open, {
      leftAt: null,
      seconds: null,
      window: qpWindow(30),
    });

    const map = await desired();

    expect([...map.keys()]).toEqual([]);
  });
});
