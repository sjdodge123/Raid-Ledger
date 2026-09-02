/**
 * ROK-1463 C1 — the game-time grid stores LOCAL wall-clock hours.
 *
 * `game_time_templates.start_hour` / `game_time_overrides.hour` are written
 * from a grid the FE renders in the member's OWN timezone preference, and
 * `game_time_overrides.date` / `game_time_absences.start_date` are that
 * member's local calendar days. `GET /lfg/:gameId/overlap` therefore has to
 * convert each `(local date, local hour)` into a UTC instant — per member —
 * before intersecting, or two members whose evenings never actually coincide
 * are reported as a full overlap.
 *
 * Split out of `lfg-reads.integration.spec.ts` (which fixes everything in UTC)
 * because every case here needs an explicitly NON-UTC member zone. The suite
 * still runs under `TZ=UTC`: the runner's own zone must not matter.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { DAY_MS, createGame } from './lfg.integration.spec-helpers';
import {
  HOUR_MS,
  addAbsence,
  instantOfLocalHour,
  setGameTimeOverride,
  setGameTimeTemplate,
  setUserTimezone,
  zonedParts,
  type LfgOverlapResponseDto,
} from './lfg-reads.integration.spec-helpers';

/** UTC-4/-5 — a 20:00 local block lands on the NEXT UTC calendar day. */
const NEW_YORK = 'America/New_York';
/** UTC+1/+2 — the same local hour is hours apart from the New York one. */
const BERLIN = 'Europe/Berlin';
/** The wall-clock hour every fixture below puts on the grid. */
const BLOCK_HOUR = 20;
/** Days of grid the read projects (`LFG_OVERLAP_HORIZON_DAYS`). */
const HORIZON_DAYS = 14;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

let memberSeq = 0;

async function member(name: string) {
  memberSeq += 1;
  return createMemberAndLogin(
    testApp,
    `${name}${memberSeq}`,
    `${name}${memberSeq}@test.local`,
  );
}

function postIntent(token: string, gameId: number) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

async function overlapOf(
  token: string,
  gameId: number,
): Promise<LfgOverlapResponseDto> {
  const res = await testApp.request
    .get(`/lfg/${gameId}/overlap`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as LfgOverlapResponseDto;
}

/**
 * Put the same wall-clock hour on EVERY weekday, so which local calendar day
 * the horizon happens to start on never decides the outcome.
 */
async function blockEveryDay(userId: number): Promise<void> {
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    await setGameTimeTemplate(testApp, userId, dayOfWeek, [BLOCK_HOUR]);
  }
}

/**
 * The local dates whose {@link BLOCK_HOUR} block falls wholly inside the read's
 * horizon, oldest first — computed from the wall clock, independently of the
 * implementation's own day enumeration.
 */
function eligibleLocalDates(timeZone: string): string[] {
  const now = Date.now();
  const horizonEnd = now + HORIZON_DAYS * DAY_MS;
  const dates: string[] = [];
  for (let offset = 0; offset <= HORIZON_DAYS; offset += 1) {
    const date = zonedParts(new Date(now + offset * DAY_MS), timeZone).date;
    if (dates.includes(date)) continue;
    const ms = instantOfLocalHour(date, BLOCK_HOUR, timeZone).getTime();
    if (ms >= now && ms + HOUR_MS <= horizonEnd) dates.push(date);
  }
  return dates;
}

/** Two live members of one group, both grid-blocked at 20:00 in `timeZone`. */
async function pairInZone(timeZone: string, gameName: string) {
  const game = await createGame(testApp, gameName);
  const a = await member('alpha');
  const b = await member('bravo');
  await postIntent(a.token, game.id);
  await postIntent(b.token, game.id);
  await setUserTimezone(testApp, a.userId, timeZone);
  await setUserTimezone(testApp, b.userId, timeZone);
  await blockEveryDay(a.userId);
  await blockEveryDay(b.userId);
  return { game, a, b };
}

describe('GET /lfg/:gameId/overlap — member timezones (C1)', () => {
  it('projects a local 20:00 block onto the matching UTC instant', async () => {
    const { game, a } = await pairInZone(NEW_YORK, 'Local Hour Game');
    const [firstDate] = eligibleLocalDates(NEW_YORK);

    const [window] = (await overlapOf(a.token, game.id)).windows;

    expect(new Date(window.start).getTime()).toBe(
      instantOfLocalHour(firstDate, BLOCK_HOUR, NEW_YORK).getTime(),
    );
    expect(zonedParts(new Date(window.start), NEW_YORK).hour).toBe(BLOCK_HOUR);
    // The naive reading — hour 20 as 20:00 UTC — is a different instant.
    expect(new Date(window.start).getUTCHours()).not.toBe(BLOCK_HOUR);
    expect(
      new Date(window.end).getTime() - new Date(window.start).getTime(),
    ).toBe(HOUR_MS);
  });

  it('reports no overlap when the two members are in different zones', async () => {
    const game = await createGame(testApp, 'Split Zone Game');
    const a = await member('alpha');
    const b = await member('bravo');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);
    await setUserTimezone(testApp, a.userId, NEW_YORK);
    await setUserTimezone(testApp, b.userId, BERLIN);
    await blockEveryDay(a.userId);
    await blockEveryDay(b.userId);

    const body = await overlapOf(a.token, game.id);

    // 20:00 in Berlin is 18:00/19:00 UTC; 20:00 in New York is 00:00/01:00 UTC
    // the next day. The two evenings never coincide, so there is nothing to
    // offer — reading both hours as 20:00 UTC would advertise a full overlap.
    expect(body.memberCount).toBe(2);
    expect(body.windows).toEqual([]);
  });

  it('applies an absence on the member LOCAL calendar day', async () => {
    const { game, a } = await pairInZone(NEW_YORK, 'Local Absence Game');
    const [firstDate, secondDate] = eligibleLocalDates(NEW_YORK);

    await addAbsence(testApp, a.userId, firstDate, firstDate);

    const { windows } = await overlapOf(a.token, game.id);
    // The 20:00 New York block on `firstDate` runs at 00:00 UTC the NEXT day,
    // so comparing the absence against the instant's UTC date would leave it
    // standing.
    const starts = windows.map((w) => new Date(w.start).getTime());
    expect(starts).not.toContain(
      instantOfLocalHour(firstDate, BLOCK_HOUR, NEW_YORK).getTime(),
    );
    expect(starts[0]).toBe(
      instantOfLocalHour(secondDate, BLOCK_HOUR, NEW_YORK).getTime(),
    );
  });

  it('applies a blocked override on the member LOCAL calendar day', async () => {
    const { game, a } = await pairInZone(NEW_YORK, 'Local Override Game');
    const [firstDate, secondDate] = eligibleLocalDates(NEW_YORK);

    await setGameTimeOverride(
      testApp,
      a.userId,
      firstDate,
      BLOCK_HOUR,
      'blocked',
    );

    const { windows } = await overlapOf(a.token, game.id);
    const starts = windows.map((w) => new Date(w.start).getTime());
    expect(starts).not.toContain(
      instantOfLocalHour(firstDate, BLOCK_HOUR, NEW_YORK).getTime(),
    );
    expect(starts[0]).toBe(
      instantOfLocalHour(secondDate, BLOCK_HOUR, NEW_YORK).getTime(),
    );
  });
});
