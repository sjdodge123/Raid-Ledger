/**
 * ROK-1462 (slice D) — sourcing for the PUG invite's personalized fields.
 *
 * Covers spec D2/D3 + AC1: fixed priority owned > wishlist > hearted, never
 * more than two fields, and — the property that matters most on a notification
 * path — the lookup NEVER throws and NEVER blocks the DM.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type * as schema from '../../drizzle/schema';
import type { SignupStatus } from '../../drizzle/schema/event-signups';
import {
  countSignedUp,
  loadPugInviteData,
  loadPugInvitePersonalization,
} from './pug-invite-personalization.helpers';
import { buildPugInviteEmbed } from './pug-invite.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const NOW = Date.UTC(2026, 8, 4, 19, 20);
const GAME = { id: 7, coverUrl: 'https://cdn.example/drg.jpg' };

function interest(source: string, extra: Record<string, unknown> = {}) {
  return {
    source,
    playtimeForever: null,
    createdAt: new Date(Date.UTC(2026, 5, 14)),
    ...extra,
  };
}

/** Queue the three reads in order: game row, user row, interest rows. */
function queue(
  db: MockDb,
  rows: { game?: unknown[]; user?: unknown[]; interests?: unknown[] },
): void {
  db.limit
    .mockResolvedValueOnce(rows.game ?? [GAME])
    .mockResolvedValueOnce(rows.user ?? [{ id: 11 }])
    .mockResolvedValueOnce(rows.interests ?? []);
}

function run(db: MockDb, over: Record<string, unknown> = {}) {
  return loadPugInvitePersonalization(db as unknown as Db, {
    discordUserId: 'discord-1',
    gameId: 7,
    now: NOW,
    ...over,
  });
}

describe('loadPugInvitePersonalization', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('renders owned playtime in hours', async () => {
    queue(db, {
      interests: [interest('steam_library', { playtimeForever: 8_520 })],
    });

    const { fields } = await run(db);

    expect(fields).toEqual([
      {
        kind: 'owned',
        name: '\u{1F3AE} In your library',
        value: '142 hrs played',
      },
    ]);
  });

  it('falls back to Owned when the playtime is unknown', async () => {
    queue(db, { interests: [interest('steam_library')] });

    const { fields } = await run(db);

    expect(fields[0]).toMatchObject({ kind: 'owned', value: 'Owned' });
  });

  it('renders the live deal on a wishlisted game', async () => {
    queue(db, {
      game: [
        {
          ...GAME,
          itadCurrentCut: 67,
          itadCurrentPrice: '9.89',
          itadCurrentUrl: 'https://itad.example/drg',
          itadPriceUpdatedAt: new Date(NOW),
        },
      ],
      interests: [interest('steam_wishlist')],
    });

    const { fields } = await run(db);

    expect(fields[0]).toMatchObject({
      kind: 'wishlist',
      value: '[−67% · $9.89](https://itad.example/drg)',
    });
  });

  it('falls back to Wishlisted without a live price', async () => {
    queue(db, { interests: [interest('steam_wishlist')] });

    const { fields } = await run(db);

    expect(fields[0]).toMatchObject({ kind: 'wishlist', value: 'Wishlisted' });
  });

  it('renders the heart date for a manual interest', async () => {
    queue(db, { interests: [interest('manual')] });

    const { fields } = await run(db);

    expect(fields[0]).toMatchObject({ kind: 'hearted', value: 'on 14 Jun' });
  });

  it('keeps at most two fields, in the order owned > wishlist > hearted', async () => {
    queue(db, {
      interests: [
        interest('manual'),
        interest('steam_wishlist'),
        interest('steam_library', { playtimeForever: 60 }),
      ],
    });

    const { fields } = await run(db);

    expect(fields.map((f) => f.kind)).toEqual(['owned', 'wishlist']);
  });

  it('returns the game cover for the embed thumbnail', async () => {
    queue(db, {});

    const { coverUrl } = await run(db);

    expect(coverUrl).toBe('https://cdn.example/drg.jpg');
  });

  it('reads nothing at all without a game', async () => {
    const result = await run(db, { gameId: null });

    expect(result).toEqual({ fields: [], coverUrl: null });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('keeps the cover but drops fields when there is no Discord user', async () => {
    db.limit.mockResolvedValueOnce([GAME]);

    const result = await run(db, { discordUserId: null });

    expect(result).toEqual({
      fields: [],
      coverUrl: 'https://cdn.example/drg.jpg',
    });
  });

  it('degrades to no fields when the user has no account', async () => {
    queue(db, { user: [] });

    const { fields, coverUrl } = await run(db);

    expect(fields).toEqual([]);
    expect(coverUrl).toBe('https://cdn.example/drg.jpg');
  });

  it('never throws when the interests lookup fails', async () => {
    db.limit
      .mockResolvedValueOnce([GAME])
      .mockRejectedValueOnce(new Error('connection terminated'));

    await expect(run(db)).resolves.toEqual({
      fields: [],
      coverUrl: 'https://cdn.example/drg.jpg',
    });
  });

  it('never throws when the game lookup fails', async () => {
    db.limit.mockRejectedValue(new Error('connection terminated'));

    await expect(run(db)).resolves.toEqual({ fields: [], coverUrl: null });
  });
});

describe('countSignedUp', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('returns the confirmed signup count', async () => {
    db.limit.mockResolvedValueOnce([{ value: 7 }]);

    await expect(countSignedUp(db as unknown as Db, 42)).resolves.toBe(7);
  });

  it('returns null, not 0, when the row is missing or malformed', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(countSignedUp(db as unknown as Db, 42)).resolves.toBeNull();

    db.limit.mockResolvedValueOnce([{ value: '7' }]);
    await expect(countSignedUp(db as unknown as Db, 42)).resolves.toBeNull();
  });

  it('never throws when the count query fails, and never invents a 0', async () => {
    db.limit.mockRejectedValueOnce(new Error('connection terminated'));

    await expect(countSignedUp(db as unknown as Db, 42)).resolves.toBeNull();
  });
});

describe('loadPugInviteData', () => {
  it('combines personalization with the signup count', async () => {
    const db = createDrizzleMock();
    // The two lookups run concurrently: the count's single read lands after
    // the personalization's first (game) read and before its user read.
    db.limit
      .mockResolvedValueOnce([GAME])
      .mockResolvedValueOnce([{ value: 3 }])
      .mockResolvedValueOnce([{ id: 11 }])
      .mockResolvedValueOnce([interest('manual')]);

    const result = await loadPugInviteData(db as unknown as Db, {
      discordUserId: 'discord-1',
      gameId: 7,
      eventId: 42,
      now: NOW,
    });

    expect(result.signupCount).toBe(3);
    expect(result.coverUrl).toBe('https://cdn.example/drg.jpg');
    expect(result.fields.map((f) => f.kind)).toEqual(['hearted']);
  });
});

/**
 * ROK-1462 — the DM's spots line must quote the SAME roster the app does.
 *
 * `countSignedUp` originally matched `status = 'signed_up'` only, so an 8-cap
 * event with 7 confirmed + 1 tentative rendered "1 spot open · 7 of 8 signed
 * up" next to a roster the app already considered full. The canonical count
 * (`events/event-query.helpers.ts::buildSignupCountSubquery`) excludes
 * `roached_out` / `departed` / `declined` and treats everything else —
 * including `tentative` — as holding a spot.
 */
const ALL_STATUSES: SignupStatus[] = [
  'signed_up',
  'tentative',
  'declined',
  'roached_out',
  'departed',
];

/** The signup statuses a captured WHERE clause would actually count. */
function countedStatuses(where: SQL): SignupStatus[] {
  const { sql: text, params } = new PgDialect().sqlToQuery(where);
  const at = (i: string): string => String(params[Number(i) - 1]);
  const excluded = [...text.matchAll(/"status" <> \$(\d+)/g)].map((m) =>
    at(m[1]),
  );
  const included = [...text.matchAll(/"status" = \$(\d+)/g)].map((m) => at(m[1]));
  return ALL_STATUSES.filter((s) =>
    included.length > 0 ? included.includes(s) : !excluded.includes(s),
  );
}

/** A db whose count query honestly applies its own predicate to `roster`. */
function rosterDb(roster: SignupStatus[]): MockDb {
  const db = createDrizzleMock();
  db.limit.mockImplementation(() => {
    const where = db.where.mock.calls.at(-1)?.[0] as SQL;
    const counted = countedStatuses(where);
    const value = roster.filter((s) => counted.includes(s)).length;
    return Promise.resolve([{ value }]);
  });
  return db;
}

function eventFixture(): typeof schema.events.$inferSelect {
  return {
    id: 42,
    title: 'Deep Rock Galactic — Friday Deep Dive',
    gameId: 7,
    maxAttendees: 8,
    duration: [
      new Date(Date.UTC(2026, 8, 4, 20, 0)),
      new Date(Date.UTC(2026, 8, 4, 22, 0)),
    ],
  } as unknown as typeof schema.events.$inferSelect;
}

/** Render the PUG invite DM description for a given roster count. */
function describeInvite(signupCount: number | null): string {
  const { embed } = buildPugInviteEmbed({
    pugSlotId: 'slot-1',
    eventId: 42,
    event: eventFixture(),
    communityName: 'Test Guild',
    clientUrl: 'https://rl.example',
    voiceChannelId: null,
    signupCount,
    now: NOW,
  });
  return embed.toJSON().description ?? '';
}

describe('the spots line agrees with the roster (ROK-1462)', () => {
  it('counts tentative signups, like the canonical roster count', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValueOnce([{ value: 8 }]);

    await countSignedUp(db as unknown as Db, 42);

    const where = db.where.mock.calls[0][0] as SQL;
    expect(countedStatuses(where)).toEqual(['signed_up', 'tentative']);
  });

  it('renders a full roster as full when one of the eight is tentative', async () => {
    const roster: SignupStatus[] = [
      ...(Array(7).fill('signed_up') as SignupStatus[]),
      'tentative',
    ];
    const count = await countSignedUp(rosterDb(roster) as unknown as Db, 42);

    expect(describeInvite(count)).toContain('8 of 8 signed up');
    expect(describeInvite(count)).not.toContain('spot open');
  });

  it('still excludes roached_out, departed and declined', async () => {
    const roster: SignupStatus[] = [
      'signed_up',
      'signed_up',
      'tentative',
      'roached_out',
      'departed',
      'declined',
    ];
    const count = await countSignedUp(rosterDb(roster) as unknown as Db, 42);

    expect(count).toBe(3);
    expect(describeInvite(count)).toContain('5 spots open · 3 of 8 signed up');
  });

  it('renders NO spots line rather than a fake count when the read fails', async () => {
    const db = createDrizzleMock();
    db.limit.mockRejectedValueOnce(new Error('connection terminated'));

    const count = await countSignedUp(db as unknown as Db, 42);

    expect(count).toBeNull();
    expect(describeInvite(count)).not.toMatch(/signed up|spot/);
    expect(describeInvite(count)).toContain('📅');
  });
});
