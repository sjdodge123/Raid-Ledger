/**
 * ROK-2272 S7b — the community-lineup discussion lifecycle against a real
 * database (spec §3.1, §3.6, §3.7; R4, R6, R8, R11). Create / status edges go
 * through the real EventEmitter2 (the S6 emits) into
 * `LineupDiscussionListener`; idempotency, concurrency, private, unhub and
 * carrier cases call the reconciler directly. Every test builds its own hub
 * and lineup.
 */
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { LINEUP_LIFECYCLE_EVENTS } from '../../../lineups/lineup-events.constants';
import {
  LINEUP_CLOSE_GRACE_MS,
  lineupThreadTitle,
  planLineupSync,
  syncLineupDiscussion,
} from './lineup-discussion.sync';

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

const emitter = () => testApp.app.get(EventEmitter2);
const threads = schema.hubForumThreads;
type Status = 'building' | 'voting' | 'decided' | 'archived';

async function newHub(): Promise<number> {
  seq += 1;
  const name = `Lineup Discussion ${seq} ${Date.now()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return g.id;
}

interface LineupOpts {
  guildId?: number | null;
  visibility?: 'public' | 'private';
  status?: Status;
  /** A standalone poll's carrier row (`phase_duration_override.standalone`). */
  standalone?: boolean;
  title?: string;
}

async function newLineup(opts: LineupOpts = {}): Promise<number> {
  const [l] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: opts.title ?? `Lineup ${seq} ${Date.now()}`,
        ...(opts.standalone
          ? { phaseDurationOverride: { standalone: true } }
          : {}),
        status: opts.status ?? 'building',
        visibility: opts.visibility ?? 'public',
        createdBy: testApp.seed.adminUser.id,
        guildId: opts.guildId ?? null,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  return l.id;
}

const threadRows = (lineupId: number) =>
  testApp.db.select().from(threads).where(eq(threads.lineupId, lineupId));

async function liveThread(lineupId: number) {
  const [row] = await testApp.db
    .select()
    .from(threads)
    .where(
      and(eq(threads.lineupId, lineupId), isNull(threads.eventDetachedAt)),
    );
  return row;
}

const setLineup = (lineupId: number, status: Status) =>
  testApp.db
    .update(schema.communityLineups)
    .set({ status })
    .where(eq(schema.communityLineups.id, lineupId));

describe('planLineupSync (decision table)', () => {
  const base = {
    lineupId: 1,
    title: 'L',
    creatorId: 1,
    standalone: false,
    guildId: 7,
    visibility: 'public' as const,
  };
  it('inserts only for an open hub lineup', () => {
    for (const status of ['building', 'voting'] as const) {
      expect(planLineupSync({ ...base, status }, null)).toBe('insert');
    }
    for (const status of ['decided', 'archived'] as const) {
      expect(planLineupSync({ ...base, status }, null)).toBe('noop');
    }
    const carrier = { ...base, status: 'building' as const, standalone: true };
    expect(planLineupSync(carrier, null)).toBe('noop');
  });
  it('detaches a thread whose lineup is private, unhubbed or gone', () => {
    const th = { guildId: 7 };
    const open = { ...base, status: 'voting' as const };
    expect(planLineupSync({ ...open, visibility: 'private' }, th)).toBe(
      'detach',
    );
    expect(planLineupSync({ ...open, guildId: null }, th)).toBe('detach');
    expect(planLineupSync(null, th)).toBe('detach');
    expect(planLineupSync({ ...open, guildId: 8 }, th)).toBe('move');
  });
});

describe('syncLineupDiscussion (real db)', () => {
  it('a hub lineup created emits into exactly one thread with lineup_id (R4, R11)', async () => {
    const guildId = await newHub();
    const title = `Friday games ${Date.now()}`;
    const lineupId = await newLineup({ guildId, title });
    emitter().emit(LINEUP_LIFECYCLE_EVENTS.CREATED, {
      lineupId,
      visibility: 'public',
      guildId,
      standalone: false,
    });
    await waitFor(async () => {
      expect(await threadRows(lineupId)).toHaveLength(1);
    }, 5000);
    expect(await liveThread(lineupId)).toMatchObject({
      guildId,
      lineupId,
      eventId: null,
      matchId: null,
      authorId: testApp.seed.adminUser.id,
      title: `${title} — Lineup`,
      writeClosesAt: null,
    });
    expect(lineupThreadTitle(title)).toBe(`${title} — Lineup`);
  });

  it('a second sync is a refresh no-op — still one thread', async () => {
    const lineupId = await newLineup({ guildId: await newHub() });
    expect(await syncLineupDiscussion(testApp.db, lineupId)).toBe('insert');
    expect(await syncLineupDiscussion(testApp.db, lineupId)).toBe('refresh');
    expect(await threadRows(lineupId)).toHaveLength(1);
  });

  it('concurrent syncs still produce exactly one thread', async () => {
    const lineupId = await newLineup({ guildId: await newHub() });
    const runs = Array.from({ length: 5 }, () =>
      syncLineupDiscussion(testApp.db, lineupId),
    );
    const actions = await Promise.all(runs);
    expect(actions.filter((a) => a === 'insert')).toHaveLength(1);
    expect(await threadRows(lineupId)).toHaveLength(1);
  });

  it.each<[string, LineupOpts]>([
    ['with no hub', { guildId: null }],
    ['private (§3.7)', { visibility: 'private' }],
    ['already decided when first seen', { status: 'decided' }],
    ['already archived when first seen', { status: 'archived' }],
    ['a standalone poll carrier (§3.1)', { standalone: true }],
  ])('a lineup %s gets no thread', async (_what, opts) => {
    const guildId = opts.guildId === null ? null : await newHub();
    const lineupId = await newLineup({ ...opts, guildId });
    expect(await syncLineupDiscussion(testApp.db, lineupId)).toBe('noop');
    expect(await threadRows(lineupId)).toHaveLength(0);
  });
});

describe('syncLineupDiscussion close + detach (real db)', () => {
  it('public → private closes and detaches the thread (R6)', async () => {
    const lineupId = await newLineup({ guildId: await newHub() });
    await syncLineupDiscussion(testApp.db, lineupId);
    await testApp.db
      .update(schema.communityLineups)
      .set({ visibility: 'private' })
      .where(eq(schema.communityLineups.id, lineupId));
    const now = new Date();
    expect(await syncLineupDiscussion(testApp.db, lineupId, now)).toBe(
      'detach',
    );
    const rows = await threadRows(lineupId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventDetachedAt?.getTime()).toBe(now.getTime());
    expect(rows[0]?.writeClosesAt?.getTime()).toBe(now.getTime());
    expect(await liveThread(lineupId)).toBeUndefined();
  });

  it.each([
    ['decided', 'decided'],
    ['cancelled (archived)', 'archived'],
  ] as const)(
    '%s sets write_closes_at ≈ now + 1 h (R1/R2)',
    async (_what, status) => {
      const lineupId = await newLineup({
        guildId: await newHub(),
        status: 'voting',
      });
      await syncLineupDiscussion(testApp.db, lineupId);
      await setLineup(lineupId, status);
      const before = Date.now();
      emitter().emit(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, {
        lineupId,
        from: 'voting',
        to: status,
        standalone: false,
      });
      await waitFor(async () => {
        expect((await liveThread(lineupId))?.writeClosesAt).toBeInstanceOf(
          Date,
        );
      }, 5000);
      const closes = (await liveThread(lineupId))?.writeClosesAt?.getTime();
      expect(closes).toBeGreaterThanOrEqual(before + LINEUP_CLOSE_GRACE_MS);
      expect(closes).toBeLessThanOrEqual(Date.now() + LINEUP_CLOSE_GRACE_MS);
      // A later sync keeps the first deadline (idempotent).
      await syncLineupDiscussion(
        testApp.db,
        lineupId,
        new Date(before + 600_000),
      );
      expect((await liveThread(lineupId))?.writeClosesAt?.getTime()).toBe(
        closes,
      );
    },
  );
});

describe('syncLineupDiscussion reopen (real db)', () => {
  it('decided → voting (revert) clears the deadline', async () => {
    const lineupId = await newLineup({ guildId: await newHub() });
    await syncLineupDiscussion(testApp.db, lineupId);
    await setLineup(lineupId, 'decided');
    await syncLineupDiscussion(testApp.db, lineupId);
    expect((await liveThread(lineupId))?.writeClosesAt).toBeInstanceOf(Date);
    await setLineup(lineupId, 'voting');
    expect(await syncLineupDiscussion(testApp.db, lineupId)).toBe('refresh');
    expect((await liveThread(lineupId))?.writeClosesAt).toBeNull();
  });
});
