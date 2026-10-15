/**
 * ROK-1787 — `GET /plugins/wow/guilds/:id/raids` through the real HTTP stack
 * and DB (spec P5–P9): access (403/404), the guild-event filter (cancelled,
 * other-guild and untagged events excluded), upcoming vs recent split at
 * now, one schedule row per series, composition from roster_assignments,
 * attendance math over current linked members, and the viewer's status.
 */
import { randomUUID } from 'node:crypto';
import { AuthService } from '../../../auth/auth.service';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const HOUR = 3600 * 1000;
const MMO = { type: 'mmo', tank: 2, healer: 4, dps: 14 };
type Who = 'member' | 'alt' | 'outsider' | 'pug';

let testApp: TestApp;
let guildId: number;
let otherGuildId: number;
const users = {} as Record<Who, { id: number; charId: string; token: string }>;
const ids = {} as Record<string, number>;
const groups = { a: randomUUID(), b: randomUUID() };

async function insertGuild(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function seedUser(who: Who, rankIndex: number | null): Promise<void> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `raids-${who}`, username: who, role: 'member' })
      .returning(),
    'user',
  );
  const guid = `Player-7-${who}`;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: who,
        addonGuid: guid,
        role: 'dps',
        isMain: true,
      })
      .returning(),
    'character',
  );
  if (rankIndex !== null) {
    await testApp.db.insert(schema.guildMembers).values({
      guildId,
      guid,
      characterName: who,
      rankIndex,
      rankName: `Rank ${rankIndex}`,
      source: 'addon_import',
      lastSeenAt: SNAP,
    });
  }
  const token = testApp.app
    .get(AuthService)
    .login({ id: user.id, username: who, role: 'member' }).access_token;
  users[who] = { id: user.id, charId: char.id, token };
}

interface Ev {
  key: string;
  startH: number;
  guild?: number | null;
  group?: string;
  rule?: string;
  slot?: unknown;
  cancelled?: boolean;
}

async function ev(e: Ev): Promise<number> {
  const start = new Date(Date.now() + e.startH * HOUR);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: e.key,
        gameId: testApp.seed.game.id,
        creatorId: users.member.id,
        duration: [start, new Date(start.getTime() + 3 * HOUR)],
        guildId: e.guild === undefined ? guildId : e.guild,
        recurrenceGroupId: e.group ?? null,
        recurrenceRule: e.rule ? { frequency: e.rule } : null,
        slotConfig: e.slot ?? null,
        cancelledAt: e.cancelled ? new Date() : null,
      })
      .returning(),
    e.key,
  );
  ids[e.key] = row.id;
  return row.id;
}

async function signup(
  eventId: number,
  who: Who,
  extra: { status?: string; attendanceStatus?: string } = {},
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId: users[who].id,
        characterId: users[who].charId,
        ...extra,
      })
      .returning(),
    'signup',
  );
  return row.id;
}

/** Next free slot per (event, role): `unique_slot_per_event` forbids reuse. */
const nextSlot = new Map<string, number>();

async function rosterOn(
  eventId: number,
  who: Who,
  role: string,
  extra: { status?: string } = {},
) {
  const signupId = await signup(eventId, who, extra);
  const key = `${eventId}:${role}`;
  const position = (nextSlot.get(key) ?? 0) + 1;
  nextSlot.set(key, position);
  await testApp.db
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId, role, position });
}

async function seedEvents(): Promise<void> {
  const soon = await ev({ key: 'soon', startH: 24, slot: { type: 'generic' } });
  await signup(soon, 'member', { status: 'tentative' });
  // Departed mid-raid: no longer counted as signed up on a live card.
  await signup(soon, 'alt', { status: 'departed' });
  await ev({ key: 'b1', startH: 30, group: groups.b, rule: 'biweekly' });
  const mmo = await ev({ key: 'mmo', startH: 48, slot: MMO });
  await rosterOn(mmo, 'member', 'tank');
  await rosterOn(mmo, 'alt', 'bench');
  // Departure moves the assignment to bench; they are not available.
  await rosterOn(mmo, 'pug', 'bench', { status: 'departed' });
  await ev({ key: 'a1', startH: 72, group: groups.a, rule: 'weekly' });
  await ev({ key: 'a2', startH: 240, group: groups.a, rule: 'weekly' });
  await ev({ key: 'cancelled', startH: 12, cancelled: true });
  await ev({ key: 'other', startH: 12, guild: otherGuildId });
  await ev({ key: 'untagged', startH: 12, guild: null });
  const done = await ev({ key: 'done', startH: -48 });
  await signup(done, 'member', { attendanceStatus: 'attended' });
  await signup(done, 'alt', { attendanceStatus: 'no_show' });
  await signup(done, 'pug', { attendanceStatus: 'attended' });
  // Declined but showed up: not "signed up", so not in the attended numerator.
  await signup(done, 'outsider', {
    status: 'declined',
    attendanceStatus: 'attended',
  });
  const unrecorded = await ev({ key: 'unrecorded', startH: -24 });
  await signup(unrecorded, 'member');
  const old = await ev({ key: 'old', startH: -24 * 70 });
  await signup(old, 'member', { attendanceStatus: 'attended' });
}

function getRaids(id: number, token: string) {
  return testApp.request
    .get(`/plugins/wow/guilds/${id}/raids`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Raid Keepers');
  otherGuildId = await insertGuild('Other Keepers');
  await seedUser('member', 1);
  await seedUser('alt', 2);
  await seedUser('outsider', null);
  await seedUser('pug', null);
  await seedEvents();
});

describe('GET /plugins/wow/guilds/:id/raids — access', () => {
  it('is 403 for a non-member', async () => {
    const res = await getRaids(guildId, users.outsider.token);
    expect(res.status).toBe(403);
  });

  it('is 404 for a missing guild (staff viewer)', async () => {
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    expect((await getRaids(987654, admin)).status).toBe(404);
  });
});

describe('GET /plugins/wow/guilds/:id/raids — payload', () => {
  let body: Record<string, unknown> & {
    upcoming: { id: number; signupCount: number; viewerStatus: unknown }[];
    recent: { id: number; signedUp: number; attended: number | null }[];
    schedule: {
      eventId: number;
      recurrenceGroupId: string;
      isNext: boolean;
      frequency: unknown;
    }[];
    composition: {
      event: { id: number };
      roles: unknown[];
      benched: unknown[];
    } | null;
    attendance: { rows: { userId: number; attended: number; of: number }[] };
    nextRaid: { id: number } | null;
  };

  beforeAll(async () => {
    const res = await getRaids(guildId, users.member.token);
    expect(res.status).toBe(200);
    body = res.body as typeof body;
  });

  it('lists only live tagged upcoming events, soonest first; nextRaid = the first', () => {
    expect(body.upcoming.map((e) => e.id)).toEqual(
      ['soon', 'b1', 'mmo', 'a1', 'a2'].map((k) => ids[k]),
    );
    expect(body.nextRaid?.id).toBe(ids.soon);
  });

  it('carries the viewer status and signup count per card (departed excluded)', () => {
    const soon = body.upcoming.find((e) => e.id === ids.soon);
    expect(soon).toMatchObject({ viewerStatus: 'tentative', signupCount: 1 });
    const a1 = body.upcoming.find((e) => e.id === ids.a1);
    expect(a1?.viewerStatus).toBeNull();
  });

  it('lists ended events in the 8-week window, newest first, attended null when unrecorded', () => {
    expect(body.recent).toEqual([
      expect.objectContaining({
        id: ids.unrecorded,
        signedUp: 1,
        attended: null,
      }),
      // attended ⊆ signedUp: the declined-but-attended outsider is excluded.
      expect.objectContaining({ id: ids.done, signedUp: 3, attended: 2 }),
    ]);
  });

  it('has one schedule row per series (its next night), isNext on the earliest', () => {
    expect(body.schedule).toEqual([
      expect.objectContaining({
        recurrenceGroupId: groups.b,
        eventId: ids.b1,
        isNext: true,
        frequency: 'biweekly',
      }),
      expect.objectContaining({
        recurrenceGroupId: groups.a,
        eventId: ids.a1,
        isNext: false,
        frequency: 'weekly',
      }),
    ]);
  });

  it('builds composition from the next MMO event roster, with the bench (departed excluded)', () => {
    expect(body.composition?.event.id).toBe(ids.mmo);
    expect(body.composition?.roles).toEqual([
      { role: 'tank', filled: 1, needed: 2 },
      { role: 'healer', filled: 0, needed: 4 },
      { role: 'dps', filled: 0, needed: 14 },
    ]);
    expect(body.composition?.benched).toEqual([
      { characterId: users.alt.charId, name: 'alt' },
    ]);
  });

  it('counts attendance over recorded window events for current members only', () => {
    expect(body.attendance.rows).toEqual([
      expect.objectContaining({ userId: users.member.id, attended: 1, of: 1 }),
      expect.objectContaining({ userId: users.alt.id, attended: 0, of: 1 }),
    ]);
  });
});
