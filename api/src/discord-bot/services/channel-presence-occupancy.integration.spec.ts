/**
 * ROK-1499 — the occupancy ledger against a real database.
 *
 * The unit specs mock drizzle, so the three things that can only break HERE
 * are unasserted anywhere else:
 *
 * - the partial `left_at IS NULL` predicates really do leave a closed stay
 *   alone (a mock returns whatever it was told to, violation or not);
 * - the overlap predicate in `loadRoomActivities` really does join
 *   `game_activity_sessions → users → games` and fall back to
 *   `discord_activity_name` for an unmapped title;
 * - the FK's ON DELETE CASCADE really does exist in the migration — a table
 *   whose cascade was only ever declared in TypeScript leaks every stay of
 *   every deleted presence message.
 *
 * Every instant is derived from the presence row AFTER it round-trips the
 * database, and every assertion is a DIFFERENCE between two stored instants.
 * `timestamp` columns carry no zone and nothing pins `TZ` in the test env, so
 * an absolute `toEqual(new Date(...))` would pass in UTC and fail on a laptop
 * in CEST — the offset cancels out of a difference.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  closeAllOccupancy,
  listOccupancy,
  reconcileOccupancy,
} from './channel-presence-occupancy.helpers';
import { hydrateRoomRecap } from './channel-presence-room-recap.hydrate';
import type { PresenceRow } from './channel-presence-store.helpers';
import type { RoomMember } from './channel-presence-occupancy.helpers';

/**
 * Room members for the ledger. Names only — the `gameId` / `activityName`
 * columns are exercised explicitly by the tests that care about them.
 */
function present(names: Record<string, string>): Map<string, RoomMember> {
  return new Map(
    Object.entries(names).map(([id, displayName]) => [
      id,
      { displayName, gameId: null, activityName: null },
    ]),
  );
}
type Db = PostgresJsDatabase<typeof schema>;

const GUILD_ID = 'rok1499-guild';
const VOICE_CHANNEL_ID = 'rok1499-voice';
const TEXT_CHANNEL_ID = 'rok1499-text';
const MINUTE = 60_000;

/** A `general-lobby` binding on the voice channel — the FK needs a real row. */
async function insertBinding(db: Db): Promise<string> {
  const [binding] = await db
    .insert(schema.channelBindings)
    .values({
      guildId: GUILD_ID,
      channelId: VOICE_CHANNEL_ID,
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      config: { minPlayers: 2, gracePeriod: 60 },
    })
    .returning();
  return binding.id;
}

/** An open presence row, read back so its `opened_at` is the stored one. */
async function insertPresenceRow(
  db: Db,
  bindingId: string,
  openedAt: Date,
): Promise<PresenceRow> {
  const [row] = await db
    .insert(schema.discordChannelPresenceMessages)
    .values({
      guildId: GUILD_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
      bindingId,
      textChannelId: TEXT_CHANNEL_ID,
      messageId: 'rok1499-message',
      openedAt,
    })
    .returning();
  return row;
}

/** Seconds between two stored instants — offset-invariant by construction. */
function minutesBetween(from: Date, to: Date | null): number | null {
  return to === null ? null : (to.getTime() - from.getTime()) / MINUTE;
}

describe('channel presence occupancy (integration, ROK-1499)', () => {
  let testApp: TestApp;
  let db: Db;
  let bindingId: string;
  let row: PresenceRow;
  /** The row's stored `opened_at`; every fixture instant hangs off it. */
  let t0: Date;

  const at = (minutes: number): Date =>
    new Date(t0.getTime() + minutes * MINUTE);

  beforeAll(async () => {
    testApp = await getTestApp();
    db = testApp.db;
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  beforeEach(async () => {
    bindingId = await insertBinding(db);
    row = await insertPresenceRow(
      db,
      bindingId,
      new Date('2026-03-05T20:00:00Z'),
    );
    t0 = row.openedAt;
  });

  describe('reconcileOccupancy', () => {
    it('opens one stay per present member on the first call', async () => {
      await reconcileOccupancy(
        db,
        row.id,
        present({ u1: 'Ada', u2: 'Bo' }),
        t0,
      );

      const stays = await listOccupancy(db, row.id);
      expect(stays).toHaveLength(2);
      expect(stays.map((s) => s.discordUserId).sort()).toEqual(['u1', 'u2']);
      expect(stays.map((s) => s.displayName).sort()).toEqual(['Ada', 'Bo']);
      expect(stays.every((s) => s.leftAt === null)).toBe(true);
    });

    it('stamps only the member who left and leaves the other open', async () => {
      const both = present({ u1: 'Ada', u2: 'Bo' });
      await reconcileOccupancy(db, row.id, both, t0);

      await reconcileOccupancy(db, row.id, present({ u1: 'Ada' }), at(20));

      const stays = await listOccupancy(db, row.id);
      const ada = stays.find((s) => s.discordUserId === 'u1');
      const bo = stays.find((s) => s.discordUserId === 'u2');
      expect(ada?.leftAt).toBeNull();
      expect(minutesBetween(t0, bo?.leftAt ?? null)).toBe(20);
    });

    it('opens a NEW stay on rejoin rather than reviving the closed one', async () => {
      await reconcileOccupancy(db, row.id, present({ u2: 'Bo' }), t0);
      await reconcileOccupancy(db, row.id, new Map(), at(20));

      await reconcileOccupancy(db, row.id, present({ u2: 'Bo' }), at(45));

      const stays = await listOccupancy(db, row.id);
      expect(stays).toHaveLength(2);
      expect(stays.map((s) => minutesBetween(t0, s.joinedAt))).toEqual([0, 45]);
      expect(stays.map((s) => minutesBetween(t0, s.leftAt))).toEqual([
        20,
        null,
      ]);
    });
  });

  describe('closeAllOccupancy', () => {
    it('stamps every open stay at the given instant, idempotently', async () => {
      await reconcileOccupancy(
        db,
        row.id,
        present({ u1: 'Ada', u2: 'Bo' }),
        t0,
      );
      await reconcileOccupancy(db, row.id, present({ u1: 'Ada' }), at(10));

      await closeAllOccupancy(db, row.id, at(30));
      // The second empty flush must not restamp what the first one closed —
      // that is how every stay in the room collapses to zero.
      await closeAllOccupancy(db, row.id, at(90));

      const stays = await listOccupancy(db, row.id);
      const closedAt = stays
        .map((s) => minutesBetween(t0, s.leftAt))
        .sort((a, b) => Number(a) - Number(b));
      expect(closedAt).toEqual([10, 30]);
    });
  });

  describe('hydrateRoomRecap', () => {
    /** A member with a stay, plus the activity they were playing during it. */
    async function seedMember(
      discordId: string,
      displayName: string,
      stay: { from: number; to: number | null },
    ): Promise<number> {
      const [user] = await db
        .insert(schema.users)
        .values({ discordId, username: displayName, role: 'member' })
        .returning();
      await seedStay(discordId, displayName, stay);
      return user.id;
    }

    /** A stay with no `users` row behind it — an UNLINKED occupant (P2-2). */
    async function seedStay(
      discordUserId: string,
      displayName: string,
      stay: { from: number; to: number | null },
      game: { gameId?: number; activityName?: string } = {},
    ): Promise<void> {
      await db.insert(schema.discordChannelPresenceOccupancy).values({
        presenceMessageId: row.id,
        discordUserId,
        displayName,
        gameId: game.gameId ?? null,
        activityName: game.activityName ?? null,
        joinedAt: at(stay.from),
        leftAt: stay.to === null ? null : at(stay.to),
      });
    }

    async function seedSession(
      userId: number,
      gameId: number | null,
      activityName: string,
      span: { from: number; to: number | null },
    ): Promise<void> {
      await db.insert(schema.gameActivitySessions).values({
        userId,
        gameId,
        discordActivityName: activityName,
        startedAt: at(span.from),
        endedAt: span.to === null ? null : at(span.to),
      });
    }

    it('summarises the span, the members and both mapped and unmapped games', async () => {
      const [game] = await db
        .insert(schema.games)
        .values({ name: 'Deep Rock Galactic', slug: 'rok1499-drg' })
        .returning();
      const ada = await seedMember('u1', 'Ada', { from: 0, to: 90 });
      const bo = await seedMember('u2', 'Bo', { from: 30, to: null });
      // Started BEFORE the room opened: the normal "launch the game, then join
      // voice" case the overlap predicate exists for.
      await seedSession(ada, game.id, 'Deep Rock Galactic', {
        from: -20,
        to: 90,
      });
      await seedSession(bo, null, 'Slay the Spire II', { from: 60, to: null });

      // Cass is NOT a linked Raid Ledger user, so she has no
      // `game_activity_sessions` row and never will — her game exists only on
      // the stay the room wrote (P2-2). 30 min, shortest of the three.
      await seedStay('u3', 'Cass', { from: 0, to: 30 }, { gameId: game.id });

      const recap = await hydrateRoomRecap(db, row, at(120));

      expect(recap.spanMs).toBe(120 * MINUTE);
      expect(recap.members).toEqual([
        { displayName: 'Ada', seconds: 90 * 60 },
        { displayName: 'Bo', seconds: 90 * 60 },
        { displayName: 'Cass', seconds: 30 * 60 },
      ]);
      // Name AND duration together, longest first: two equal durations would
      // leave the mapping unpinned, so Bo plays for an hour and Ada 90 minutes.
      // Ada's session is clipped to the span at BOTH ends; Bo's open session
      // clamps to the instant the room emptied.
      // Cass's 30 min sums into Deep Rock Galactic alongside Ada's 90 —
      // without the occupancy fallback her game would be missing entirely.
      expect(recap.activities).toEqual([
        { name: 'Deep Rock Galactic', seconds: 120 * 60 },
        { name: 'Slay the Spire II', seconds: 60 * 60 },
      ]);
    });
  });

  it('cascades: deleting the presence row removes its stays', async () => {
    await reconcileOccupancy(db, row.id, present({ u1: 'Ada' }), t0);
    // Without this the assertion below passes just as happily on an insert
    // that never happened.
    expect(await listOccupancy(db, row.id)).toHaveLength(1);

    await db
      .delete(schema.discordChannelPresenceMessages)
      .where(eq(schema.discordChannelPresenceMessages.id, row.id));

    expect(await listOccupancy(db, row.id)).toEqual([]);
  });
});
