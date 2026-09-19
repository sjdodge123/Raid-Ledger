/**
 * ROK-1624 — the EVENT CREATED card names the people actually rostered.
 *
 * Operator report 2026-09-18 (Valheim, poll finished after expiry): the embed
 * said `Players (12)` and listed the whole match group while the event's
 * roster held 5, because ROK-1610 changed WHO GETS ROSTERED (the locked slot's
 * voters) without changing WHO GETS ANNOUNCED (`findMatchMemberUsers`).
 *
 * AC3 is explicit that the regression case needs M < N — a fixture where
 * everyone voted passes either way — so every case here runs a 12-person group
 * against a 5-person roster and asserts the SEVEN NON-VOTERS BY NAME are
 * absent, not just that a count came out right.
 */
import {
  resolveEventRosterNames,
  type EventRosterUser,
} from './lineup-notification-event-roster.helpers';
import {
  buildEventCreatedEmbed,
  type EmbedContext,
} from './lineup-notification-embed.helpers';
import * as schema from '../drizzle/schema';

type Db = Parameters<typeof resolveEventRosterNames>[0];

const EVENT_ID = 55;

/** The operator's screenshot: 12 in the group, 5 of them on the event. */
const ROSTERED = [
  'bullet33',
  'pariah___',
  '.gladwrap',
  'hiphoptobop',
  'metaveix',
];
const NON_VOTERS = [
  'halfdeadz3dd',
  'squidlicker',
  'tomato',
  'vex',
  'wrenchy',
  'yuzu',
  'zephyr',
];
const GROUP = [...ROSTERED, ...NON_VOTERS].map((displayName, i) => ({
  userId: i + 1,
  displayName,
}));

const ROSTER_ROWS: EventRosterUser[] = ROSTERED.map((displayName, i) => ({
  userId: i + 1,
  displayName,
}));

/**
 * Minimal stand-in for the drizzle chain `findEventRosterUsers` issues:
 * `.select().from(eventSignups).innerJoin(users).where(...)`. `fromTable`
 * records what was queried so a fix that "works" by reading the match-members
 * table cannot pass.
 */
function fakeDb(rows: EventRosterUser[]) {
  const seen: { fromTable?: unknown } = {};
  const db = {
    select: () => ({
      from: (table: unknown) => {
        seen.fromTable = table;
        return {
          innerJoin: () => ({ where: () => Promise.resolve(rows) }),
        };
      },
    }),
  } as unknown as Db;
  return { db, seen };
}

function ctx(): EmbedContext {
  return {
    baseUrl: 'https://raid.example',
    lineupId: 1,
    communityName: 'Test Guild',
    phase: 'decided',
    lineupTitle: 'September Lineup',
  };
}

/** The `👥 Players (N)` field of the rendered card, or undefined. */
function playersField(names: string[]) {
  const { embed } = buildEventCreatedEmbed(
    ctx(),
    'Valheim',
    3,
    new Date('2026-09-18T19:00:00.000Z'),
    EVENT_ID,
    names,
  );
  return (embed.toJSON().fields ?? []).find((f) => f.name.includes('Players'));
}

describe('resolveEventRosterNames (ROK-1624 AC1/AC3)', () => {
  it('names the 5 rostered players, not the 12-person group', async () => {
    const { db } = fakeDb(ROSTER_ROWS);

    const names = await resolveEventRosterNames(db, EVENT_ID, GROUP);

    expect(names).toEqual(ROSTERED);
    for (const absent of NON_VOTERS) {
      expect(names).not.toContain(absent);
    }
  });

  it('reads the event signups, not the match membership', async () => {
    const { db, seen } = fakeDb(ROSTER_ROWS);

    await resolveEventRosterNames(db, EVENT_ID, GROUP);

    expect(seen.fromTable).toBe(schema.eventSignups);
  });

  it('falls back to the group when there is no linked event (AC2)', async () => {
    const { db, seen } = fakeDb(ROSTER_ROWS);

    const names = await resolveEventRosterNames(db, undefined, GROUP);

    expect(names).toHaveLength(GROUP.length);
    expect(names).toContain('halfdeadz3dd');
    expect(seen.fromTable).toBeUndefined();
  });
});

describe('EVENT CREATED card (ROK-1624 AC1)', () => {
  it('headers the roster count and omits the non-voters', async () => {
    const { db } = fakeDb(ROSTER_ROWS);
    const names = await resolveEventRosterNames(db, EVENT_ID, GROUP);

    const field = playersField(names);

    expect(field?.name).toContain(`Players (${ROSTERED.length})`);
    expect(field?.name).not.toContain(`Players (${GROUP.length})`);
    expect(field?.value).toContain('**bullet33**');
    expect(field?.value).not.toContain('halfdeadz3dd');
    // 5 ≤ the six-name cap, so nothing is collapsed away to hide a miscount.
    expect(field?.value).not.toContain('more');
  });

  it('omits the field entirely when nobody is rostered', async () => {
    const { db } = fakeDb([]);
    const names = await resolveEventRosterNames(db, EVENT_ID, GROUP);

    expect(playersField(names)).toBeUndefined();
  });
});
