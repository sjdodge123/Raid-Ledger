/**
 * ROK-1968 §8.3 — the hub "Before next session" note against a real database
 * (T-I1–T-I16): per-kind read / save / tick rights, the members-only 404, the
 * D8 `baseUpdatedAt` 409, the clear-after pin (next tagged event, lazy expiry,
 * cancelled/deleted pin, keep-the-pin on re-save, the D5b armed pin) and the
 * item-cascade clear.
 * Users are created once; every test builds its own hub, so randomized order
 * never shares a note. No afterAll DB work: the shared setup closes the pool.
 */
import { and, eq } from 'drizzle-orm';
import type { GuildKind, HubSessionNoteResponse } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { loginAsAdmin } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import { deleteExpiredNote } from './hub-session-note.queries';

type Who = 'admin' | 'editor' | 'member' | 'outsider';
type Method = 'get' | 'put' | 'patch' | 'delete';

const HOUR = 3_600_000;
const SOURCE: Record<GuildKind, string> = {
  wow_guild: 'addon_import',
  game_server: 'pelican',
  game_community: 'community',
};
const PLUGINS = ['blizzard', PELICAN_PLUGIN_ID] as const;

let testApp: TestApp;
const tokens = {} as Record<Who, string>;
const userIds = {} as Record<Who, number>;
let seq = 0;

const registry = () => testApp.app.get(PluginRegistryService);

beforeAll(async () => {
  testApp = await getTestApp();
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
  userIds.admin = testApp.seed.adminUser.id;
  for (const who of ['editor', 'member', 'outsider'] as const) {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:sn-${who}@session-note.test`,
          username: `sn-${who}`,
          displayName: `Session ${who}`,
          role: 'member',
        })
        .returning(),
      `user ${who}`,
    );
    userIds[who] = u.id;
    tokens[who] = await signTestAccessToken(testApp, {
      sub: u.id,
      username: u.username,
      role: 'member',
    });
  }
});

beforeEach(async () => {
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
});

// ── seeding ────────────────────────────────────────────────────────────────

async function insertHub(
  kind: GuildKind,
  extra: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<number> {
  seq += 1;
  const name = `Session Note ${kind} ${seq}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind,
        region: kind === 'game_community' ? 'community' : 'us',
        source: SOURCE[kind],
        name,
        nameKey: name.toLowerCase(),
        lastSnapshotAt: new Date(),
        ...extra,
      })
      .returning(),
    `${kind} hub`,
  );
  return g.id;
}

/** Community hub: `editor` is an officer, `member` a plain member. */
async function communityHub(): Promise<number> {
  const guildId = await insertHub('game_community', { status: 'active' });
  await testApp.db.insert(schema.hubCommunityMembers).values([
    { guildId, userId: userIds.editor, role: 'officer' },
    { guildId, userId: userIds.member, role: 'member' },
  ]);
  return guildId;
}

/** A character on the WoW guild's live roster; returns the member row id. */
async function linkWow(guildId: number, userId: number): Promise<number> {
  const guid = `Player-1-sessionnote-${guildId}-${userId}`;
  const name = `Sn${guildId}x${userId}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name,
    addonGuid: guid,
    role: 'dps',
    isMain: false,
  });
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: name,
        rankIndex: 3,
        rankName: 'Rank 3',
        source: 'addon_import',
        lastSeenAt: new Date(),
      })
      .returning(),
    'guild member',
  );
  return m.id;
}

/** WoW guild: `editor` is a delegated officer, `member` a plain linked member. */
async function wowHub(
  extra: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<number> {
  const guildId = await insertHub('wow_guild', extra);
  const officerId = await linkWow(guildId, userIds.editor);
  await linkWow(guildId, userIds.member);
  await testApp.db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId: officerId });
  return guildId;
}

/** Server hub: `member` joined manually; no officer rung exists. */
async function serverHub(): Promise<number> {
  const guildId = await insertHub('game_server');
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId,
    userId: userIds.member,
    source: 'manual',
    joinedAt: new Date(),
  });
  return guildId;
}

/** An event tagged to `guildId`, `startH` hours from now, `lenH` long. */
async function insertEvent(
  guildId: number,
  startH: number,
  extra: Partial<typeof schema.events.$inferInsert> = {},
  lenH = 2,
): Promise<number> {
  const start = Date.now() + startH * HOUR;
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `Session event ${seq}-${startH}`,
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        guildId,
        duration: [new Date(start), new Date(start + lenH * HOUR)],
        ...extra,
      })
      .returning(),
    'event',
  );
  return e.id;
}

/** A real lineup match, so an event can point `reschedulingPollId` at it. */
async function insertLineupMatch(): Promise<number> {
  const [lineup] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `Session note poll ${seq}`,
        createdBy: testApp.seed.adminUser.id,
        publicSlug: `sn-poll-${seq}`,
      })
      .returning({ id: schema.communityLineups.id }),
    'lineup',
  );
  const [match] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({ lineupId: lineup.id, gameId: testApp.seed.game.id })
      .returning({ id: schema.communityLineupMatches.id }),
    'lineup match',
  );
  return match.id;
}

// ── requests ───────────────────────────────────────────────────────────────

function call(method: Method, path: string, who: Who, body?: object) {
  const req = testApp.request[method](path).set(
    'Authorization',
    `Bearer ${tokens[who]}`,
  );
  return body ? req.send(body) : req;
}

interface PutBody {
  body?: string;
  items?: { id?: number; text: string }[];
  clearAfterNextEvent?: boolean;
  baseUpdatedAt?: string | null;
}

const put = (guildId: number, who: Who, b: PutBody = {}) =>
  call('put', `/guilds/${guildId}/session-note`, who, {
    body: b.body ?? 'Bring flasks',
    items: b.items ?? [],
    clearAfterNextEvent: b.clearAfterNextEvent ?? false,
    baseUpdatedAt: b.baseUpdatedAt ?? null,
  });

const get = (guildId: number, who: Who) =>
  call('get', `/guilds/${guildId}/session-note`, who);

const tick = (guildId: number, itemId: number, who: Who, done = true) =>
  call('patch', `/guilds/${guildId}/session-note/items/${itemId}`, who, {
    done,
  });

const del = (guildId: number, who: Who) =>
  call('delete', `/guilds/${guildId}/session-note`, who);

/** The note of a 200 response; throws (with the status) when there is none. */
function noteOf(res: { status: number; body: unknown }) {
  const note = (res.body as HubSessionNoteResponse).note;
  if (res.status !== 200 || note === null) {
    throw new Error(`expected a 200 with a note, got ${res.status}`);
  }
  return note;
}

/** Save a note with two items as `who`; returns the stored note. */
async function seedNote(guildId: number, who: Who = 'editor', b: PutBody = {}) {
  const res = await put(guildId, who, {
    items: [{ text: 'Repair gear' }, { text: 'Bring food' }],
    ...b,
  });
  expect(res.status).toBe(200);
  return noteOf(res);
}

const noteRows = (guildId: number) =>
  testApp.db
    .select()
    .from(schema.hubSessionNotes)
    .where(eq(schema.hubSessionNotes.guildId, guildId));

const itemRows = (guildId: number) =>
  testApp.db
    .select()
    .from(schema.hubSessionNoteItems)
    .where(eq(schema.hubSessionNoteItems.guildId, guildId));

const firstItemId = (note: { items: { id: number }[] }) =>
  nonEmpty(note.items, 'note items')[0].id;

// ── community hub ──────────────────────────────────────────────────────────

describe('community hub', () => {
  it('T-I1: an officer saves; a member reads body, items and updatedBy', async () => {
    const g = await communityHub();
    await seedNote(g, 'editor', { body: 'Raid at 8' });
    const res = await get(g, 'member');
    expect(res.status).toBe(200);
    const note = noteOf(res);
    expect(note.body).toBe('Raid at 8');
    expect(note.items.map((i) => i.text)).toEqual([
      'Repair gear',
      'Bring food',
    ]);
    expect(note.updatedBy).toMatchObject({
      userId: userIds.editor,
      displayName: 'Session editor',
    });
    expect((res.body as HubSessionNoteResponse).viewer).toEqual({
      canEdit: false,
      canTick: true,
    });
  });

  it('T-I2: a member gets 403 on PUT/DELETE but ticks without moving updatedAt', async () => {
    const g = await communityHub();
    const before = await seedNote(g);
    expect((await put(g, 'member', { body: 'mine now' })).status).toBe(403);
    expect((await del(g, 'member')).status).toBe(403);
    const itemId = firstItemId(before);
    const res = await tick(g, itemId, 'member');
    expect(res.status).toBe(200);
    const after = noteOf(res);
    const item = after.items.find((i) => i.id === itemId);
    expect(item).toMatchObject({ done: true, doneAt: expect.any(String) });
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.body).toBe('Bring flasks');
    expect(after.updatedBy?.userId).toBe(userIds.editor);
  });

  it('T-I5: a visitor on an active community hub gets 404 (members only)', async () => {
    const g = await communityHub();
    await seedNote(g);
    const res = await get(g, 'outsider');
    expect(res.status).toBe(404);
    expect((res.body as { message?: string }).message).toBe('Hub not found');
  });

  it('T-I6: a second save from the same baseUpdatedAt is 409 with the first note', async () => {
    const g = await communityHub();
    const base = (await seedNote(g)).updatedAt;
    const first = await put(g, 'editor', {
      body: 'first',
      baseUpdatedAt: base,
    });
    expect(first.status).toBe(200);
    const second = await put(g, 'admin', {
      body: 'second',
      baseUpdatedAt: base,
    });
    expect(second.status).toBe(409);
    const conflict = second.body as {
      message: string;
      note: { body: string; updatedAt: string } | null;
    };
    expect(conflict.message).toBe('Note changed');
    expect(conflict.note?.body).toBe('first');
    expect(conflict.note?.updatedAt).toBe(noteOf(first).updatedAt);
    expect(nonEmpty(await noteRows(g), 'note row')[0].body).toBe('first');
  });
});

describe('community hub — clear after next event', () => {
  it('T-I7: clear-after pins the earliest eligible tagged event', async () => {
    const g = await communityHub();
    const other = await communityHub();
    await insertEvent(other, 1);
    await insertEvent(g, 2, { cancelledAt: new Date() });
    const pollId = await insertLineupMatch();
    await insertEvent(g, 3, { reschedulingPollId: pollId });
    const later = await insertEvent(g, 48);
    const earlier = await insertEvent(g, 24);
    const note = await seedNote(g, 'editor', { clearAfterNextEvent: true });
    expect(note.clearAfter?.eventId).toBe(earlier);
    expect(note.clearAfter?.eventId).not.toBe(later);
    expect(nonEmpty(await noteRows(g), 'note row')[0].clearAfterEventId).toBe(
      earlier,
    );
  });

  it('T-I9a: a cancelled pin keeps the note and drops the auto-clear', async () => {
    const g = await communityHub();
    const eventId = await insertEvent(g, 1);
    await seedNote(g, 'editor', { clearAfterNextEvent: true });
    const past = Date.now() - 3 * HOUR;
    await testApp.db
      .update(schema.events)
      .set({
        cancelledAt: new Date(),
        duration: [new Date(past), new Date(past + HOUR)],
      })
      .where(eq(schema.events.id, eventId));
    const note = noteOf(await get(g, 'member'));
    expect(note.body).toBe('Bring flasks');
    expect(note.clearAfter).toBeNull();
    expect(note.clearAfterPending).toBe(false);
  });

  it('T-I9b: a deleted pin sets the FK null and the note remains', async () => {
    const g = await communityHub();
    const eventId = await insertEvent(g, 1);
    await seedNote(g, 'editor', { clearAfterNextEvent: true });
    await testApp.db.delete(schema.events).where(eq(schema.events.id, eventId));
    const note = noteOf(await get(g, 'member'));
    expect(note.clearAfter).toBeNull();
    expect(note.clearAfterPending).toBe(false);
    expect(nonEmpty(await noteRows(g), 'note row')[0].clearAfterEventId).toBe(
      null,
    );
  });
});

describe('community hub — armed clear-after (D5b)', () => {
  it('T-I10: clear-after with no upcoming event arms the note (D5b)', async () => {
    const g = await communityHub();
    await insertEvent(g, -5);
    const res = await put(g, 'editor', { clearAfterNextEvent: true });
    expect(res.status).toBe(200);
    const note = noteOf(res);
    expect(note.clearAfter).toBeNull();
    expect(note.clearAfterPending).toBe(true);
    expect(nonEmpty(await noteRows(g), 'note row')[0]).toMatchObject({
      clearAfterEventId: null,
      clearAfterArmed: true,
    });
  });

  it('T-I16: an armed note pins the first event created later on GET, then auto-clears after it ends', async () => {
    const g = await communityHub();
    const armed = await seedNote(g, 'editor', { clearAfterNextEvent: true });
    expect(armed.clearAfterPending).toBe(true);
    const later = await insertEvent(g, 48);
    const first = await insertEvent(g, 24);
    const pinned = noteOf(await get(g, 'member'));
    expect(pinned.clearAfter?.eventId).toBe(first);
    expect(pinned.clearAfter?.eventId).not.toBe(later);
    expect(pinned.clearAfterPending).toBe(false);
    // The pin is not an edit: the D8 concurrency token is untouched.
    expect(pinned.updatedAt).toBe(armed.updatedAt);
    expect(nonEmpty(await noteRows(g), 'note row')[0]).toMatchObject({
      clearAfterEventId: first,
      clearAfterArmed: false,
    });
    const past = Date.now() - 3 * HOUR;
    await testApp.db
      .update(schema.events)
      .set({ duration: [new Date(past), new Date(past + HOUR)] })
      .where(eq(schema.events.id, first));
    const res = await get(g, 'member');
    expect((res.body as HubSessionNoteResponse).note).toBeNull();
    expect(await noteRows(g)).toEqual([]);
  });

  it('T-I16c: an armed note whose next event was created and ended before any read is cleared', async () => {
    const g = await communityHub();
    await seedNote(g, 'editor', { clearAfterNextEvent: true });
    // Armed 4h ago; the event ran 3h→1h ago; nobody opened the hub since.
    await testApp.db
      .update(schema.hubSessionNotes)
      .set({ updatedAt: new Date(Date.now() - 4 * HOUR) })
      .where(eq(schema.hubSessionNotes.guildId, g));
    await insertEvent(g, -3);
    await insertEvent(g, 24); // a later event the note must NOT pin
    const res = await get(g, 'member');
    expect(res.status).toBe(200);
    expect((res.body as HubSessionNoteResponse).note).toBeNull();
    expect(await noteRows(g)).toEqual([]);
    expect(await itemRows(g)).toEqual([]);
  });
});

describe('community hub — re-saves of the clear-after toggle', () => {
  it('T-I14: re-saving with the toggle on keeps the existing upcoming pin', async () => {
    const g = await communityHub();
    const e = await insertEvent(g, 48);
    const first = await seedNote(g, 'editor', { clearAfterNextEvent: true });
    expect(first.clearAfter?.eventId).toBe(e);
    const f = await insertEvent(g, 24);
    const res = await put(g, 'editor', {
      body: 'Updated plan',
      clearAfterNextEvent: true,
      baseUpdatedAt: first.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(noteOf(res).clearAfter?.eventId).toBe(e);
    // The editor's toggle label now names F — the pin deliberately does not.
    expect((res.body as HubSessionNoteResponse).nextEvent?.eventId).toBe(f);
  });

  it('T-I16b: turning the toggle off disarms an armed note', async () => {
    const g = await communityHub();
    const armed = await seedNote(g, 'editor', { clearAfterNextEvent: true });
    const res = await put(g, 'editor', {
      clearAfterNextEvent: false,
      baseUpdatedAt: armed.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(noteOf(res).clearAfterPending).toBe(false);
    await insertEvent(g, 24);
    expect(noteOf(await get(g, 'member')).clearAfter).toBeNull();
  });
});

describe('community hub — expiry', () => {
  it('T-I8: once the pinned event has ended, GET answers null and deletes the row', async () => {
    const g = await communityHub();
    const eventId = await insertEvent(g, 1);
    const note = await seedNote(g, 'editor', { clearAfterNextEvent: true });
    expect(note.clearAfter?.eventId).toBe(eventId);
    const past = Date.now() - 3 * HOUR;
    await testApp.db
      .update(schema.events)
      .set({ duration: [new Date(past), new Date(past + HOUR)] })
      .where(eq(schema.events.id, eventId));
    const res = await get(g, 'member');
    expect(res.status).toBe(200);
    expect((res.body as HubSessionNoteResponse).note).toBeNull();
    expect(await noteRows(g)).toEqual([]);
    expect(await itemRows(g)).toEqual([]);
  });

  it('T-I15: the expiry DELETE re-checks the event, so a pin changed since the read survives', async () => {
    const g = await communityHub();
    const eventId = await insertEvent(g, 24);
    await seedNote(g, 'editor', { clearAfterNextEvent: true });
    // A caller that read a stale "ended" snapshot: the event is still upcoming.
    await deleteExpiredNote(testApp.db, g, eventId, new Date());
    expect(await noteRows(g)).toHaveLength(1);
    // Ended but cancelled since the read: still kept (ruling 5).
    const past = Date.now() - 3 * HOUR;
    await testApp.db
      .update(schema.events)
      .set({
        cancelledAt: new Date(),
        duration: [new Date(past), new Date(past + HOUR)],
      })
      .where(eq(schema.events.id, eventId));
    await deleteExpiredNote(testApp.db, g, eventId, new Date());
    expect(await noteRows(g)).toHaveLength(1);
    // Control: ended and uncancelled — deleted, items cascade.
    await testApp.db
      .update(schema.events)
      .set({ cancelledAt: null })
      .where(eq(schema.events.id, eventId));
    await deleteExpiredNote(testApp.db, g, eventId, new Date());
    expect(await noteRows(g)).toEqual([]);
    expect(await itemRows(g)).toEqual([]);
  });
});

describe('community hub — delete and cross-hub ticks', () => {
  it('T-I11: DELETE twice is 204 both times and cascades the items', async () => {
    const g = await communityHub();
    await seedNote(g);
    expect(await itemRows(g)).toHaveLength(2);
    expect((await del(g, 'editor')).status).toBe(204);
    expect((await del(g, 'editor')).status).toBe(204);
    expect(await noteRows(g)).toEqual([]);
    expect(await itemRows(g)).toEqual([]);
    expect((await get(g, 'member')).body).toMatchObject({ note: null });
  });

  it("T-I12: hub B's item ticked via hub A is 404 and B's item is unchanged", async () => {
    const a = await communityHub();
    const b = await communityHub();
    await seedNote(a);
    const itemB = firstItemId(await seedNote(b));
    const res = await tick(a, itemB, 'member');
    expect(res.status).toBe(404);
    expect((res.body as { message?: string }).message).toBe(
      'Checklist item not found',
    );
    const [row] = await testApp.db
      .select()
      .from(schema.hubSessionNoteItems)
      .where(
        and(
          eq(schema.hubSessionNoteItems.id, itemB),
          eq(schema.hubSessionNoteItems.guildId, b),
        ),
      );
    expect(row).toMatchObject({ done: false, doneAt: null, doneBy: null });
  });
});

// ── WoW guild ──────────────────────────────────────────────────────────────

describe('WoW guild', () => {
  it('T-I3: a delegated officer saves, a plain member is 403 on PUT but ticks', async () => {
    const g = await wowHub();
    const note = await seedNote(g, 'editor');
    expect(
      (await put(g, 'member', { baseUpdatedAt: note.updatedAt })).status,
    ).toBe(403);
    const itemId = firstItemId(note);
    const res = await tick(g, itemId, 'member');
    expect(res.status).toBe(200);
    expect(noteOf(res).items.find((i) => i.id === itemId)?.done).toBe(true);
  });

  it('T-I13: a hidden hub answers 404 to a non-staff member (HubVisibleGuard)', async () => {
    const g = await wowHub();
    await seedNote(g, 'editor');
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, g));
    const res = await get(g, 'member');
    expect(res.status).toBe(404);
    // The guard's message, not the service's members-only 'Hub not found'.
    expect((res.body as { message?: string }).message).toBe('Guild not found');
    expect((await get(g, 'admin')).status).toBe(200);
  });
});

// ── server hub ─────────────────────────────────────────────────────────────

describe('server hub', () => {
  it('T-I4: admin saves; a member is 403 on PUT but ticks; a non-member is 404', async () => {
    const g = await serverHub();
    const note = await seedNote(g, 'admin');
    expect(note.updatedBy?.userId).toBe(userIds.admin);
    expect(
      (await put(g, 'member', { baseUpdatedAt: note.updatedAt })).status,
    ).toBe(403);
    const itemId = firstItemId(note);
    const res = await tick(g, itemId, 'member');
    expect(res.status).toBe(200);
    expect(noteOf(res).items.find((i) => i.id === itemId)?.done).toBe(true);
    expect((await get(g, 'outsider')).status).toBe(404);
  });
});
