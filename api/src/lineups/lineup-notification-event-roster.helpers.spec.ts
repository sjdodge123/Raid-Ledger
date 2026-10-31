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
  formatGroupSignupSubtext,
  resolveEventRosterCard,
  type EventRosterUser,
} from './lineup-notification-event-roster.helpers';
import {
  buildEventCreatedEmbed,
  type EmbedContext,
} from './lineup-notification-embed.helpers';
import { checkAutoBench } from '../events/signups-signup.helpers';
import * as schema from '../drizzle/schema';

type Db = Parameters<typeof resolveEventRosterCard>[0];

/** The card's names only — the ROK-1624 cases below predate the subtext. */
async function resolveEventRosterNames(
  ...args: Parameters<typeof resolveEventRosterCard>
): Promise<string[]> {
  return (await resolveEventRosterCard(...args)).names;
}

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
/**
 * The event row the ROK-2054 capacity read returns (no cap by default), plus
 * `occupied`: what the shared occupied-slot count (`isEventAtCapacity`, the
 * `checkAutoBench` query) returns — non-bench roster ASSIGNMENTS, which is
 * deliberately not the roster length.
 */
interface CapRow {
  slotConfig: unknown;
  maxAttendees: number | null;
  occupied?: number;
}
const NO_CAP: CapRow = { slotConfig: null, maxAttendees: null };

function fakeDb(rows: EventRosterUser[], event: CapRow = NO_CAP) {
  const seen: { fromTable?: unknown; countJoin?: unknown } = {};
  const db = {
    select: () => ({
      from: (table: unknown) => {
        seen.fromTable ??= table;
        return {
          innerJoin: (joined: unknown) => {
            if (joined === schema.users) {
              return { where: () => Promise.resolve(rows) };
            }
            // ROK-2054: the occupied-slot count, joined to roster assignments.
            seen.countJoin = joined;
            const count = event.occupied ?? 0;
            return { where: () => Promise.resolve([{ count }]) };
          },
          // ROK-2054: `.from(events).where(...).limit(1)` — the cap read.
          where: () => ({ limit: () => Promise.resolve([event]) }),
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
function playersField(names: string[], groupSubtext?: string) {
  const { embed } = buildEventCreatedEmbed(
    ctx(),
    'Valheim',
    3,
    new Date('2026-09-18T19:00:00.000Z'),
    EVENT_ID,
    names,
    groupSubtext,
  );
  return (embed.toJSON().fields ?? []).find((f) => f.name.includes('Players'));
}

describe('resolveEventRosterCard names (ROK-1624 AC1/AC3)', () => {
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

const GROUP_IDS = GROUP.map((m) => m.userId);
const ROSTER_IDS = ROSTER_ROWS.map((r) => r.userId);

describe('formatGroupSignupSubtext (ROK-1863 AC1–AC3)', () => {
  it('says N of M when fewer than the whole group is rostered', () => {
    expect(formatGroupSignupSubtext(ROSTER_IDS, GROUP_IDS)).toBe(
      '5 of 12 from the group signed up',
    );
  });

  it('returns null when every group member is rostered', () => {
    expect(formatGroupSignupSubtext(GROUP_IDS, GROUP_IDS)).toBeNull();
  });

  it('returns null when there is no group', () => {
    expect(formatGroupSignupSubtext(ROSTER_IDS, [])).toBeNull();
  });

  it('does not count a rostered non-member (the organiser) in N', () => {
    const ORGANISER = 999;
    expect(
      formatGroupSignupSubtext([...ROSTER_IDS, ORGANISER], GROUP_IDS),
    ).toBe('5 of 12 from the group signed up');
  });

  it('does not let a non-member fill the last gap and hide the line', () => {
    const allButOne = GROUP_IDS.slice(1);
    expect(formatGroupSignupSubtext([...allButOne, 999], GROUP_IDS)).toBe(
      '11 of 12 from the group signed up',
    );
  });

  it('says 0 of M when only non-members are rostered', () => {
    expect(formatGroupSignupSubtext([999], GROUP_IDS)).toBe(
      '0 of 12 from the group signed up',
    );
  });
});

describe('resolveEventRosterCard groupSubtext (ROK-1863)', () => {
  it('carries the N of M line for a short roster', async () => {
    const { db } = fakeDb(ROSTER_ROWS);

    const card = await resolveEventRosterCard(db, EVENT_ID, GROUP);

    expect(card.groupSubtext).toBe('5 of 12 from the group signed up');
  });

  it('has no line when there is no linked event — the names ARE the group', async () => {
    const { db } = fakeDb(ROSTER_ROWS);

    const card = await resolveEventRosterCard(db, undefined, GROUP);

    expect(card.groupSubtext).toBeNull();
  });
});

describe('EVENT CREATED card — group subtext line (ROK-1863)', () => {
  it('appends the line in italics under the roster', () => {
    const plain = playersField(ROSTERED)?.value ?? '';
    const field = playersField(ROSTERED, '5 of 12 from the group signed up');

    expect(field?.value).toBe(`${plain}\n*5 of 12 from the group signed up*`);
  });

  it('leaves the field value unchanged without a subtext', () => {
    const field = playersField(ROSTERED);

    expect(field?.value).not.toContain('from the group');
    expect(field?.value).not.toContain('-#');
  });

  it('prints no line when nobody is rostered — there is no field to hold it', () => {
    expect(
      playersField([], '0 of 12 from the group signed up'),
    ).toBeUndefined();
  });
});

/** ROK-2054: the card's description for a roster that is / is not full. */
function eventCreatedDescription(full: boolean): string {
  const { embed } = buildEventCreatedEmbed(
    ctx(),
    'Valheim',
    3,
    new Date('2026-09-18T19:00:00.000Z'),
    EVENT_ID,
    ROSTERED,
    null,
    full,
  );
  return embed.toJSON().description ?? '';
}

describe('EVENT CREATED card — capacity-aware copy (ROK-2054)', () => {
  it('says "full" and points at the waitlist when the roster is at the cap', () => {
    const description = eventCreatedDescription(true);

    expect(description).toContain(
      'is officially scheduled and full. Join the waitlist on the event page.',
    );
    expect(description).not.toContain('open for signups');
  });

  it('keeps the open-for-signups copy when there is room', () => {
    const description = eventCreatedDescription(false);

    expect(description).toContain(
      'is officially scheduled and open for signups. Head to the event page to confirm your spot.',
    );
    expect(description).not.toContain('Join the waitlist');
  });
});

/** `n` role-less voters — an MMO auto-signup leaves them unassigned. */
function voters(n: number): EventRosterUser[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: i + 1,
    displayName: `voter${i + 1}`,
  }));
}

/** The card's `full` and `checkAutoBench`'s verdict on the same event. */
async function fullAndAutoBench(rows: EventRosterUser[], event: CapRow) {
  const { db, seen } = fakeDb(rows, event);
  const card = await resolveEventRosterCard(db, EVENT_ID, GROUP);
  const autoBench = await checkAutoBench(
    db,
    {
      slotConfig: event.slotConfig,
      maxAttendees: event.maxAttendees,
    } as Parameters<typeof checkAutoBench>[1],
    EVENT_ID,
  );
  return { full: card.full, autoBench, countJoin: seen.countJoin };
}

describe('resolveEventRosterCard full = checkAutoBench full (ROK-2054)', () => {
  it('is open at cap 5 with 4 players + 1 voluntary bench (5 on the roster)', async () => {
    const out = await fullAndAutoBench(ROSTER_ROWS, {
      slotConfig: null,
      maxAttendees: 5,
      occupied: 4,
    });

    expect(out).toEqual({
      full: false,
      autoBench: false,
      countJoin: schema.rosterAssignments,
    });
  });

  it('is open for a cap-sized MMO group of unassigned voters — signup still admits', async () => {
    const out = await fullAndAutoBench(voters(25), {
      slotConfig: { type: 'mmo' },
      maxAttendees: null,
      occupied: 0,
    });

    expect(out).toEqual({
      full: false,
      autoBench: false,
      countJoin: schema.rosterAssignments,
    });
  });

  it('is full when occupied slots reach the generic slot capacity', async () => {
    const out = await fullAndAutoBench(ROSTER_ROWS, {
      slotConfig: { type: 'generic', player: 4 },
      maxAttendees: null,
      occupied: 4,
    });

    expect(out).toEqual({
      full: true,
      autoBench: true,
      countJoin: schema.rosterAssignments,
    });
  });

  it('is full when occupied slots reach maxAttendees', async () => {
    const out = await fullAndAutoBench(ROSTER_ROWS, {
      slotConfig: null,
      maxAttendees: 5,
      occupied: 5,
    });

    expect(out).toMatchObject({ full: true, autoBench: true });
  });

  it('treats a null cap as unlimited — never full, no count read', async () => {
    const out = await fullAndAutoBench(ROSTER_ROWS, {
      ...NO_CAP,
      occupied: 99,
    });

    expect(out).toEqual({
      full: false,
      autoBench: false,
      countJoin: undefined,
    });
  });
});
