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
import type * as schema from '../../drizzle/schema';
import { loadPugInvitePersonalization } from './pug-invite-personalization.helpers';

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
