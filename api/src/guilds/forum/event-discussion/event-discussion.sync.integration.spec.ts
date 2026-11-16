/**
 * ROK-2226 L2 — the event discussion lifecycle against a real database
 * (spec §5, §13 AC1–AC11). AC1/AC2 create through EventsService.create;
 * other emits go through the real EventEmitter2 (and EventsService for
 * retitle / cancel / delete); the
 * reconciler is also called directly for the race (AC9) and lazy (AC10)
 * cases. Every test builds its own hub and events.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateEventSchema } from '@raid-ledger/contract';
import { and, eq, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { APP_EVENT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import * as schema from '../../../drizzle/schema';
import { EventsService } from '../../../events/events.service';
import { isEventSignup } from './event-discussion.queries';
import {
  eventThreadRootBody,
  eventThreadTitle,
  planSync,
  syncEventDiscussion,
  WRITE_GRACE_MS,
} from './event-discussion.sync';

const HOUR = 3_600_000;
let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

const emitter = () => testApp.app.get(EventEmitter2);
const adminId = () => testApp.seed.adminUser.id;
const threads = schema.hubForumThreads;

async function newHub(): Promise<number> {
  seq += 1;
  const name = `Event Discussion ${seq} ${Date.now()}`;
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

interface EventOpts {
  title?: string;
  guildId?: number | null;
  isAdHoc?: boolean;
  endInMs?: number;
}

/** Insert an event row; the scheduled end is a whole second for exact compares. */
async function newEvent(opts: EventOpts = {}) {
  const end = new Date(
    Math.floor((Date.now() + (opts.endInMs ?? 26 * HOUR)) / 1000) * 1000,
  );
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: opts.title ?? 'Molten Core',
        creatorId: adminId(),
        gameId: testApp.seed.game.id,
        guildId: opts.guildId ?? null,
        isAdHoc: opts.isAdHoc ?? false,
        duration: [new Date(end.getTime() - 2 * HOUR), end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return { id: e.id, end };
}

const threadRows = (eventId: number) =>
  testApp.db.select().from(threads).where(eq(threads.eventId, eventId));

async function liveThread(eventId: number) {
  const [row] = await testApp.db
    .select()
    .from(threads)
    .where(and(eq(threads.eventId, eventId), isNull(threads.eventDetachedAt)));
  return row;
}

/** A hub-tagged create DTO two days out; `untilInMs` adds a weekly recurrence. */
function createDto(guildId: number, title: string, untilInMs?: number) {
  const start = Math.floor((Date.now() + 48 * HOUR) / 1000) * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  return CreateEventSchema.parse({
    title,
    startTime: iso(start),
    endTime: iso(start + 2 * HOUR),
    gameId: testApp.seed.game.id,
    guildId,
    ...(untilInMs === undefined
      ? {}
      : { recurrence: { frequency: 'weekly', until: iso(start + untilInMs) } }),
  });
}

/** Emit a lifecycle event and wait until `check` holds. */
async function emitAndWait(
  name: string,
  eventId: number,
  check: () => Promise<void>,
): Promise<void> {
  emitter().emit(name, { eventId });
  await waitFor(check, 5000);
}

describe('planSync (§5.2 table)', () => {
  const ev = { id: 1, title: 't', creatorId: 1, end: new Date() };
  it.each([
    ['deleted + live thread', null, { guildId: 1 }, 'detach'],
    [
      'eligible A, no thread',
      { ...ev, guildId: 1, isAdHoc: false },
      null,
      'insert',
    ],
    [
      'eligible A, thread in A',
      { ...ev, guildId: 1, isAdHoc: false },
      { guildId: 1 },
      'refresh',
    ],
    [
      'eligible B, thread in A',
      { ...ev, guildId: 2, isAdHoc: false },
      { guildId: 1 },
      'move',
    ],
    [
      'untagged, thread in A',
      { ...ev, guildId: null, isAdHoc: false },
      { guildId: 1 },
      'detach',
    ],
    [
      'ad-hoc, thread in A',
      { ...ev, guildId: 1, isAdHoc: true },
      { guildId: 1 },
      'detach',
    ],
    [
      'untagged, no thread',
      { ...ev, guildId: null, isAdHoc: false },
      null,
      'noop',
    ],
    ['deleted, no thread', null, null, 'noop'],
  ] as const)('%s', (_l, event, thread, want) => {
    expect(planSync(event, thread)).toBe(want);
  });

  it('truncates the title to 120 code points and escapes the root body', () => {
    const long = '🐉'.repeat(130);
    expect(Array.from(eventThreadTitle(long))).toHaveLength(120);
    expect(eventThreadTitle('   ')).toBe('Event');
    expect(eventThreadRootBody('a*b', 7)).toBe(
      'Discussion for **a\\*b**. [Open the event](/events/7)',
    );
  });
});

describe('event discussion lifecycle: create + edit (integration)', () => {
  it('AC1: EventsService.create on a hub-tagged event inserts one live thread by the creator', async () => {
    const hub = await newHub();
    const dto = createDto(hub, 'Onyxia');
    const created = await testApp.app.get(EventsService).create(adminId(), dto);
    const id = created.id;
    await waitFor(async () => {
      expect(await threadRows(id)).toHaveLength(1);
    }, 5000);
    const t = await liveThread(id);
    expect(t).toMatchObject({
      guildId: hub,
      authorId: adminId(),
      title: 'Onyxia',
      body: eventThreadRootBody('Onyxia', id),
      replyCount: 0,
      editedAt: null,
      eventDetachedAt: null,
    });
    const end = new Date(dto.endTime).getTime();
    expect(t?.writeClosesAt?.getTime()).toBe(end + WRITE_GRACE_MS);
  });

  it('AC2: a weekly series created via EventsService.create gets one thread per instance', async () => {
    const hub = await newHub();
    const dto = createDto(hub, 'Weekly raid', 3 * 7 * 24 * HOUR + HOUR);
    const created = await testApp.app.get(EventsService).create(adminId(), dto);
    const ids = created.allEventIds ?? [];
    expect(ids).toHaveLength(4);
    await waitFor(async () => {
      const rows = await testApp.db
        .select({ eventId: threads.eventId })
        .from(threads)
        .where(eq(threads.guildId, hub));
      expect(rows.map((r) => r.eventId).sort()).toEqual([...ids].sort());
    }, 5000);
  });

  it('AC3: untagged and ad-hoc events get no thread', async () => {
    const hub = await newHub();
    const untagged = await newEvent();
    const adHoc = await newEvent({ guildId: hub, isAdHoc: true });
    expect(await syncEventDiscussion(testApp.db, untagged.id)).toBe('noop');
    expect(await syncEventDiscussion(testApp.db, adHoc.id)).toBe('noop');
    expect(await threadRows(untagged.id)).toHaveLength(0);
    expect(await threadRows(adHoc.id)).toHaveLength(0);
  });

  it('AC4: a retitle via EventsService.update refreshes title + root, edited_at stays null', async () => {
    const hub = await newHub();
    const { id } = await newEvent({ guildId: hub, title: 'Old title' });
    await syncEventDiscussion(testApp.db, id);
    await testApp.app
      .get(EventsService)
      .update(id, adminId(), true, { title: 'New title' });
    await waitFor(async () => {
      expect((await liveThread(id))?.title).toBe('New title');
    }, 5000);
    const t = await liveThread(id);
    expect(t?.body).toBe(eventThreadRootBody('New title', id));
    expect(t?.editedAt).toBeNull();
  });

  it('AC5: rescheduling to a later end moves write_closes_at later (unlock)', async () => {
    const hub = await newHub();
    const { id, end } = await newEvent({ guildId: hub, endInMs: -30 * HOUR });
    await syncEventDiscussion(testApp.db, id);
    const before = (await liveThread(id))?.writeClosesAt?.getTime();
    expect(before).toBe(end.getTime() + WRITE_GRACE_MS);
    expect(before ?? Infinity).toBeLessThan(Date.now()); // was closed
    const later = new Date(end.getTime() + 48 * HOUR);
    await testApp.db
      .update(schema.events)
      .set({
        duration: [new Date(later.getTime() - 2 * HOUR), later] as [Date, Date],
      })
      .where(eq(schema.events.id, id));
    await emitAndWait(APP_EVENT_EVENTS.UPDATED, id, async () => {
      expect((await liveThread(id))?.writeClosesAt?.getTime()).toBe(
        later.getTime() + WRITE_GRACE_MS,
      );
    });
    expect(
      (await liveThread(id))?.writeClosesAt?.getTime() ?? 0,
    ).toBeGreaterThan(Date.now());
  });
});

describe('event discussion lifecycle: detach (integration)', () => {
  it('AC6: untag detaches the thread and leaves it in hub A', async () => {
    const hub = await newHub();
    const { id } = await newEvent({ guildId: hub });
    await syncEventDiscussion(testApp.db, id);
    await testApp.db
      .update(schema.events)
      .set({ guildId: null })
      .where(eq(schema.events.id, id));
    await emitAndWait(APP_EVENT_EVENTS.UPDATED, id, async () => {
      expect(await liveThread(id)).toBeUndefined();
    });
    const rows = await threadRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.guildId).toBe(hub);
    expect(rows[0]?.eventDetachedAt).toBeInstanceOf(Date);
  });

  it('AC7: retag A → B detaches A and starts a live thread in B', async () => {
    const [a, b] = [await newHub(), await newHub()];
    const { id } = await newEvent({ guildId: a });
    await syncEventDiscussion(testApp.db, id);
    await testApp.db
      .update(schema.events)
      .set({ guildId: b })
      .where(eq(schema.events.id, id));
    await emitAndWait(APP_EVENT_EVENTS.UPDATED, id, async () => {
      expect((await liveThread(id))?.guildId).toBe(b);
    });
    const rows = await threadRows(id);
    expect(rows).toHaveLength(2);
    const inA = rows.find((r) => r.guildId === a);
    expect(inA?.eventDetachedAt).toBeInstanceOf(Date);
  });

  it('AC8a: a single-event delete (emit before the row delete) detaches', async () => {
    const hub = await newHub();
    const { id } = await newEvent({ guildId: hub });
    await syncEventDiscussion(testApp.db, id);
    await testApp.app.get(EventsService).delete(id, adminId(), true);
    await waitFor(async () => {
      expect(await liveThread(id)).toBeUndefined();
    }, 5000);
    expect(await threadRows(id)).toHaveLength(1);
  });

  it('AC8b: a series delete (rows gone, then DELETED) detaches', async () => {
    const hub = await newHub();
    const { id } = await newEvent({ guildId: hub });
    await syncEventDiscussion(testApp.db, id);
    await testApp.db.delete(schema.events).where(eq(schema.events.id, id));
    await emitAndWait(APP_EVENT_EVENTS.DELETED, id, async () => {
      expect(await liveThread(id)).toBeUndefined();
    });
    // The lazy path must not resurrect a thread for a deleted event.
    expect(await syncEventDiscussion(testApp.db, id)).toBe('noop');
    expect(await threadRows(id)).toHaveLength(1);
  });
});

describe('event discussion lifecycle: race, lazy, cancel (integration)', () => {
  it('AC9: two racing syncs produce one thread', async () => {
    const hub = await newHub();
    const { id } = await newEvent({ guildId: hub });
    const actions = await Promise.all([
      syncEventDiscussion(testApp.db, id),
      syncEventDiscussion(testApp.db, id),
    ]);
    expect([...actions].sort()).toEqual(['insert', 'refresh']);
    expect(await threadRows(id)).toHaveLength(1);
  });

  it('AC10: an event tagged before 2226 gets its thread on the lazy sync', async () => {
    const hub = await newHub();
    const { id } = await newEvent({ guildId: hub });
    expect(await threadRows(id)).toHaveLength(0);
    expect(await syncEventDiscussion(testApp.db, id)).toBe('insert');
    expect((await liveThread(id))?.guildId).toBe(hub);
  });

  it('AC11: cancelling leaves the thread unchanged and writable to end + 24 h', async () => {
    const hub = await newHub();
    const { id, end } = await newEvent({ guildId: hub });
    await syncEventDiscussion(testApp.db, id);
    const before = await liveThread(id);
    await testApp.app.get(EventsService).cancel(id, adminId(), true, {});
    expect(await syncEventDiscussion(testApp.db, id)).toBe('refresh');
    const after = await liveThread(id);
    expect(after).toEqual(before);
    expect(after?.writeClosesAt?.getTime()).toBe(
      end.getTime() + WRITE_GRACE_MS,
    );
  });

  it('isEventSignup: signed_up and tentative write, declined does not', async () => {
    const { id } = await newEvent();
    const users = [];
    for (const status of ['signed_up', 'tentative', 'declined'] as const) {
      const [u] = nonEmpty(
        await testApp.db
          .insert(schema.users)
          .values({
            discordId: `local:ed-${status}-${id}@t.test`,
            username: `ed-${status}-${id}`,
          })
          .returning(),
        'user',
      );
      await testApp.db
        .insert(schema.eventSignups)
        .values({ eventId: id, userId: u.id, status });
      users.push(u.id);
    }
    const got = await Promise.all(
      users.map((u) => isEventSignup(testApp.db, id, u)),
    );
    expect(got).toEqual([true, true, false]);
  });
});
