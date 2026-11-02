/**
 * ROK-2062 — the community / game_server hub "Attendance leaderboard" read
 * (`loadCommunityHubEvents(...).attendance`) against a real database. Before
 * the fix the rows were hard-coded empty. Fleet-only (needs the integration
 * Postgres); follows `community-membership.integration.spec.ts`. Every case
 * builds its own users + hubs with unique names, so cases never share state.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { insertCommunityHub } from './community-proposals.queries';
import { loadCommunityHubEvents } from './community-events.queries';
import {
  insertDecidedLineup,
  insertSchedulingMatch,
} from '../../lineups/standalone-poll/standalone-poll-query.helpers';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

let testApp: TestApp;
let seq = 0;
const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

interface UserOpts {
  displayName?: string;
  username?: string;
  deactivated?: boolean;
}

async function mkUser(opts: UserOpts = {}): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username: opts.username ?? next('ca'),
        displayName: opts.displayName ?? null,
        discordId: `92${String(Date.now() % 1e9).padStart(9, '0')}${String(seq).padStart(5, '0')}`,
        role: 'member',
        deactivatedAt: opts.deactivated ? new Date() : null,
      })
      .returning(),
    'user',
  );
  return user.id;
}

async function mkHub(leaderId: number): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name: next('AttHub'),
    blurb: 'Attendance hub',
    status: 'active',
    proposedBy: leaderId,
    reviewedBy: null,
  });
  return hub.id;
}

interface EvOpts {
  hubId: number;
  /** Event end relative to now (negative = in the past). */
  endsInMs: number;
  cancelled?: boolean;
  /** A real lineup match id — the event is mid-reschedule. */
  reschedulingPollId?: number;
}

async function mkEvent(creatorId: number, e: EvOpts): Promise<number> {
  const end = new Date(Date.now() + e.endsInMs);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: next('att-ev'),
        gameId: testApp.seed.game.id,
        creatorId,
        duration: [new Date(end.getTime() - 3 * HOUR), end],
        guildId: e.hubId,
        cancelledAt: e.cancelled ? new Date() : null,
        reschedulingPollId: e.reschedulingPollId ?? null,
      })
      .returning(),
    'event',
  );
  return row.id;
}

type Attendance = 'attended' | 'no_show' | null;

async function signup(
  eventId: number,
  userId: number,
  attendanceStatus: Attendance,
): Promise<void> {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, attendanceStatus });
}

/** An 'attended' signup with no user — an anonymous Discord participant. */
async function anonymousSignup(eventId: number): Promise<void> {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId: null,
    discordUserId: next('anon-discord'),
    discordUsername: 'anon',
    attendanceStatus: 'attended',
  });
}

/** A real scheduling-poll match, so an event can point `reschedulingPollId` at it. */
async function mkPollId(creatorId: number): Promise<number> {
  const lineup = await insertDecidedLineup(
    testApp.db,
    creatorId,
    undefined,
    null,
  );
  const match = await insertSchedulingMatch(
    testApp.db,
    lineup.id,
    testApp.seed.game.id,
    undefined,
  );
  return match.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

describe('community hub attendance leaderboard — ranking (ROK-2062)', () => {
  it('ranks attendees by attended desc then name over ended attendance-taken events', async () => {
    const tag = next('n');
    const alpha = await mkUser({ displayName: `Alpha ${tag}` });
    const charlie = await mkUser({ displayName: `Charlie ${tag}` });
    const bravo = await mkUser({ username: `bravo-${tag}` });
    const hubId = await mkHub(alpha);
    const e1 = await mkEvent(alpha, { hubId, endsInMs: -2 * DAY });
    const e2 = await mkEvent(alpha, { hubId, endsInMs: -WEEK });
    await signup(e1, alpha, 'attended');
    await signup(e1, charlie, 'attended');
    await signup(e1, bravo, 'no_show');
    await signup(e2, alpha, 'attended');
    await signup(e2, charlie, 'no_show');
    await signup(e2, bravo, 'attended');

    const { attendance } = await loadCommunityHubEvents(
      testApp.db,
      hubId,
      alpha,
    );

    expect(attendance.windowWeeks).toBe(8);
    expect(attendance.rows).toEqual([
      {
        userId: alpha,
        characterId: null,
        name: `Alpha ${tag}`,
        attended: 2,
        of: 2,
      },
      {
        userId: bravo,
        characterId: null,
        name: `bravo-${tag}`,
        attended: 1,
        of: 2,
      },
      {
        userId: charlie,
        characterId: null,
        name: `Charlie ${tag}`,
        attended: 1,
        of: 2,
      },
    ]);
  });
});

describe('community hub attendance leaderboard — exclusions (ROK-2062)', () => {
  it('excludes cancelled, rescheduling, unrecorded, out-of-window, other-hub and upcoming events, deactivated users and anonymous signups', async () => {
    const lead = await mkUser();
    const gone = await mkUser({ deactivated: true });
    const elsewhere = await mkUser();
    const hubId = await mkHub(lead);
    const otherHub = await mkHub(lead);
    const counted = await mkEvent(lead, { hubId, endsInMs: -DAY });
    await signup(counted, lead, 'attended');
    await signup(counted, gone, 'attended');
    await anonymousSignup(counted);
    const unrecorded = await mkEvent(lead, { hubId, endsInMs: -2 * DAY });
    await signup(unrecorded, lead, null);
    const excluded = [
      await mkEvent(lead, { hubId, endsInMs: -3 * DAY, cancelled: true }),
      await mkEvent(lead, { hubId, endsInMs: -10 * WEEK }),
      await mkEvent(lead, { hubId: otherHub, endsInMs: -DAY }),
      await mkEvent(lead, { hubId, endsInMs: 2 * DAY }),
      await mkEvent(lead, {
        hubId,
        endsInMs: -4 * DAY,
        reschedulingPollId: await mkPollId(lead),
      }),
    ];
    for (const id of excluded) {
      await signup(id, lead, 'attended');
      await signup(id, elsewhere, 'attended');
    }

    const { attendance } = await loadCommunityHubEvents(
      testApp.db,
      hubId,
      lead,
    );

    expect(attendance.rows).toEqual([
      {
        userId: lead,
        characterId: null,
        name: expect.any(String),
        attended: 1,
        of: 1,
      },
    ]);
  });

  it('returns no rows when no hub event had attendance taken', async () => {
    const lead = await mkUser();
    const hubId = await mkHub(lead);
    const ev = await mkEvent(lead, { hubId, endsInMs: -DAY });
    await signup(ev, lead, null);

    const { attendance } = await loadCommunityHubEvents(
      testApp.db,
      hubId,
      lead,
    );

    expect(attendance).toEqual({ windowWeeks: 8, rows: [] });
  });
});
