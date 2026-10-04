/**
 * Scheduled-event DB readers and compares under a non-UTC DB session.
 *
 * `events.duration` and `events.extended_until` are zone-less `timestamp`s
 * holding the UTC wall clock. A `::text` read prints no offset, so `new Date()`
 * parses it as LOCAL time; a compare against a `timestamptz` (or a bare
 * `NOW()`) reads the column in the SESSION zone. Each check pins the session to
 * America/New_York inside one transaction, so it fails on ANY host if a reader
 * drops the explicit `Z` or a compare goes back to the session zone.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  findStartCandidates,
  findCompletionCandidates,
  findReconciliationCandidates,
  findRLTrackedSEs,
  findLiveRLEventsForDedup,
} from './scheduled-event.db-helpers';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HOUR_MS = 60 * 60 * 1000;

type Db = TestApp['db'];

describe('scheduled-event db-helpers under a non-UTC session', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterEach(async () => {
    app.seed = await truncateAllTables(app.db);
  });

  async function insertEvent(opts: {
    start: Date;
    end: Date;
    seId: string | null;
  }): Promise<number> {
    const [row] = await app.db
      .insert(schema.events)
      .values({
        title: 'TZ Probe',
        creatorId: app.seed.adminUser.id,
        gameId: app.seed.game.id,
        duration: [opts.start, opts.end] as [Date, Date],
        discordScheduledEventId: opts.seId,
        isAdHoc: false,
      })
      .returning({ id: schema.events.id });
    if (!row) throw new Error('event insert returned no row');
    return row.id;
  }

  /** Run `fn` on a connection whose session zone is UTC-4/-5. */
  function inNewYorkSession<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return app.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'America/New_York'`);
      return fn(tx);
    });
  }

  it('reads reconciliation and dedup bounds as ISO-Z equal to the seeded instants', async () => {
    const start = new Date(Date.now() + 26 * HOUR_MS);
    const end = new Date(start.getTime() + 3 * HOUR_MS);
    const id = await insertEvent({ start, end, seId: null });

    const { recon, dedup } = await inNewYorkSession(async (db) => ({
      recon: (await findReconciliationCandidates(db)).find((r) => r.id === id),
      dedup: (await findLiveRLEventsForDedup(db)).find((r) => r.id === id),
    }));

    expect(recon).toBeDefined();
    expect(dedup).toBeDefined();
    expect(recon?.startTime).toMatch(ISO_Z);
    expect(recon?.endTime).toMatch(ISO_Z);
    expect(dedup?.startIso).toMatch(ISO_Z);
    expect(new Date(recon?.startTime ?? '').getTime()).toBe(start.getTime());
    expect(new Date(recon?.endTime ?? '').getTime()).toBe(end.getTime());
    expect(new Date(dedup?.startIso ?? '').getTime()).toBe(start.getTime());
  });

  it('treats an event that ended 2h ago as ended in every scan', async () => {
    // Started 6h ago, ended 2h ago (UTC). Read in the session zone instead,
    // it would look like it started 1-2h ago and ends 2-3h from now.
    const now = Date.now();
    const id = await insertEvent({
      start: new Date(now - 6 * HOUR_MS),
      end: new Date(now - 2 * HOUR_MS),
      seId: 'se-ended',
    });

    const seen = await inNewYorkSession(async (db) => ({
      started: (await findStartCandidates(db)).some((r) => r.id === id),
      completed: (await findCompletionCandidates(db)).some((r) => r.id === id),
      stale:
        (await findRLTrackedSEs(db, ['se-ended'])).find((r) => r.id === id)
          ?.isStale ?? null,
      liveForDedup: (await findLiveRLEventsForDedup(db)).some(
        (r) => r.id === id,
      ),
    }));

    expect(seen).toEqual({
      started: false,
      completed: true,
      stale: true,
      liveForDedup: false,
    });
  });

  it('does not offer an event that started 2h ago for SE reconciliation', async () => {
    const now = Date.now();
    const id = await insertEvent({
      start: new Date(now - 2 * HOUR_MS),
      end: new Date(now + HOUR_MS),
      seId: null,
    });

    const offered = await inNewYorkSession(async (db) =>
      (await findReconciliationCandidates(db)).some((r) => r.id === id),
    );

    expect(offered).toBe(false);
  });

  it('offers an event whose reconcile backoff expired 2h ago, not one still backed off', async () => {
    // backoff_until is zone-less UTC too. Read in the session zone it moves
    // 4-5h later, so an expired backoff would still look active.
    const now = Date.now();
    const start = new Date(now + 26 * HOUR_MS);
    const end = new Date(start.getTime() + 3 * HOUR_MS);
    const expired = await insertEvent({ start, end, seId: null });
    const active = await insertEvent({ start, end, seId: null });
    await app.db
      .update(schema.events)
      .set({ scheduledEventReconcileBackoffUntil: new Date(now - 2 * HOUR_MS) })
      .where(eq(schema.events.id, expired));
    await app.db
      .update(schema.events)
      .set({ scheduledEventReconcileBackoffUntil: new Date(now + 2 * HOUR_MS) })
      .where(eq(schema.events.id, active));

    const offered = await inNewYorkSession(async (db) => {
      const ids = (await findReconciliationCandidates(db)).map((r) => r.id);
      return { expired: ids.includes(expired), active: ids.includes(active) };
    });

    expect(offered).toEqual({ expired: true, active: false });
  });
});
