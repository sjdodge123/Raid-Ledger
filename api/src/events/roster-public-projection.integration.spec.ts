/**
 * ROK-1629 (AC4) — public roster routes project per viewer, on real DB data.
 *
 * Anonymous and deactivated callers must receive NO `discordId` /
 * `discordUserId` / `discordAvatarHash` key at ANY depth (recursive key walk,
 * not spot checks); signed-in members and admins keep today's payload.
 *
 * Fixtures are deliberately realistic (Lead directive): every signup status, a
 * linked member, `local:` and `unlinked:` users, an anonymous Discord signup,
 * nulls in optional character fields, and real DB timestamps — so a value
 * check in the strict public parse that rejects legitimate data shows up here
 * as a 500 instead of in production.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { clearAuthUserCache } from '../auth/auth-user-cache';
import {
  createMemberAndLogin,
  createFutureEvent,
} from './signups.integration.spec-helpers';

const LINKED_SNOWFLAKE = '123456789012345678';
const ANON_SNOWFLAKE = '987654321098765432';
const CDN = 'https://cdn.discordapp.com/avatars';
const FORBIDDEN = new Set(['discordId', 'discordUserId', 'discordAvatarHash']);
/**
 * Statuses the roster shows to ANY viewer. `declined` / `roached_out` are
 * seeded but excluded upstream for everyone by `fetchRosterSignups`
 * (signups-roster-query.helpers.ts), so the projection never sees them.
 * (The second `signed_up` is created by `createFutureEvent` itself.)
 */
const ROSTER_STATUSES = ['departed', 'signed_up', 'signed_up', 'tentative'];

let testApp: TestApp;
let adminToken: string;

/** Every JSON path whose key is a Discord identity field, at any depth. */
function forbiddenPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value))
    return value.flatMap((v, i) => forbiddenPaths(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(FORBIDDEN.has(k) ? [`${path}.${k}`] : []),
    ...forbiddenPaths(v, `${path}.${k}`),
  ]);
}

interface Fixture {
  eventId: number;
  linkedUserId: number;
  memberToken: string;
  deactivatedToken: string;
}

async function insertSignup(
  eventId: number,
  values: Partial<typeof schema.eventSignups.$inferInsert>,
) {
  const rows = await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, ...values })
    .returning();
  return nonEmpty(rows, 'inserted signup')[0];
}

/** Linked member: real snowflake + avatar hash, character with null spec/ilvl. */
async function seedLinkedMember(eventId: number) {
  const { userId } = await createMemberAndLogin(
    testApp,
    'linked',
    'linked@test.local',
  );
  await testApp.db
    .update(schema.users)
    .set({ discordId: LINKED_SNOWFLAKE, avatar: 'abcdef' })
    .where(eq(schema.users.id, userId));
  const characters = await testApp.db
    .insert(schema.characters)
    .values({
      userId,
      gameId: testApp.seed.game.id,
      name: 'Linkedchar',
      class: 'Shaman',
      role: 'dps',
    })
    .returning();
  const signup = await insertSignup(eventId, {
    userId,
    status: 'signed_up',
    characterId: nonEmpty(characters, 'character')[0].id,
    note: 'private note',
    runningLateAt: new Date(),
  });
  await testApp.db
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId: signup.id, role: 'dps', position: 1 });
  return userId;
}

/**
 * `local:` (declined), `unlinked:` (tentative), `local:` (roached_out), anon
 * Discord (departed). The `unlinked:` user must hold a roster-visible status,
 * or its avatar assertion reads a row the roster never returns.
 */
async function seedOtherSignups(eventId: number) {
  const local = await createMemberAndLogin(testApp, 'loc', 'loc@test.local');
  await insertSignup(eventId, { userId: local.userId, status: 'declined' });
  const unlinkedRows = await testApp.db
    .insert(schema.users)
    .values({ discordId: 'unlinked:abc', username: 'unl', role: 'member' })
    .returning();
  await insertSignup(eventId, {
    userId: nonEmpty(unlinkedRows, 'unlinked user')[0].id,
    status: 'tentative',
  });
  const roach = await createMemberAndLogin(testApp, 'roach', 'ro@test.local');
  await insertSignup(eventId, { userId: roach.userId, status: 'roached_out' });
  await insertSignup(eventId, {
    discordUserId: ANON_SNOWFLAKE,
    discordUsername: 'guestie',
    discordAvatarHash: 'hash9',
    status: 'departed',
  });
}

async function seedFixture(): Promise<Fixture> {
  const eventId = await createFutureEvent(testApp, adminToken);
  const linkedUserId = await seedLinkedMember(eventId);
  // The creator is the linked member, so `creator.discordId` is a real id.
  await testApp.db
    .update(schema.events)
    .set({ creatorId: linkedUserId })
    .where(eq(schema.events.id, eventId));
  await seedOtherSignups(eventId);
  const member = await createMemberAndLogin(testApp, 'mem', 'mem@test.local');
  const deact = await createMemberAndLogin(testApp, 'gone', 'gone@test.local');
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: new Date() })
    .where(eq(schema.users.id, deact.userId));
  clearAuthUserCache();
  return {
    eventId,
    linkedUserId,
    memberToken: member.token,
    deactivatedToken: deact.token,
  };
}

function publicRoutes(f: Fixture): string[] {
  return [
    `/events/${f.eventId}/roster`,
    `/events/${f.eventId}/roster/assignments`,
    `/events/${f.eventId}/detail`,
    `/events?includeSignups=true`,
    `/events/${f.eventId}`,
    `/users/${f.linkedUserId}/events/signups`,
  ];
}

async function get(route: string, token?: string) {
  const req = testApp.request.get(route);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

const PUG_SNOWFLAKE = '555555555555555555';
const PUG_MEMBER_FIELDS = {
  inviteCode: 'pugcode1',
  serverInviteUrl: 'https://discord.gg/pugserver',
  discordUserId: PUG_SNOWFLAKE,
  discordAvatarHash: 'pughash',
};
const PUG_BLANK_FIELDS = {
  inviteCode: null,
  serverInviteUrl: null,
  discordUserId: null,
  discordAvatarHash: null,
};

/** A PUG slot carrying every member-only field (invite code, server URL, Discord). */
async function seedPugSlot(eventId: number) {
  await testApp.db.insert(schema.pugSlots).values({
    eventId,
    role: 'dps',
    status: 'invited',
    discordUsername: 'pugguy',
    createdBy: testApp.seed.adminUser.id,
    ...PUG_MEMBER_FIELDS,
  });
}

type DetailBody = {
  pugs: Array<Record<string, unknown>>;
  voiceChannel: { guildId: string | null } | null;
};

/** The member-only PUG fields of each slot in a detail bundle. */
function pugMemberFields(body: DetailBody) {
  return body.pugs.map((p) => ({
    inviteCode: p.inviteCode,
    serverInviteUrl: p.serverInviteUrl,
    discordUserId: p.discordUserId,
    discordAvatarHash: p.discordAvatarHash,
  }));
}

type RosterBody = {
  signups: Array<{
    status: string;
    note?: unknown;
    runningLateAt?: unknown;
    user: { username: string; avatar: string | null; discordId?: string };
  }>;
};
type AssignmentsBody = {
  assignments: Array<{ username: string; avatar: string | null }>;
};

describe('ROK-1629 public roster projection (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(async () => {
    f = await seedFixture();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    clearAuthUserCache();
  });

  it.each([
    ['anonymous', undefined],
    ['deactivated', 'deactivated'],
  ] as const)(
    'a %s caller gets no Discord id key anywhere on any public route',
    async (_label, who) => {
      const token = who ? f.deactivatedToken : undefined;
      for (const route of publicRoutes(f)) {
        const res = await get(route, token);
        expect({ route, status: res.status }).toEqual({ route, status: 200 });
        expect({ route, paths: forbiddenPaths(res.body) }).toEqual({
          route,
          paths: [],
        });
      }
    },
  );

  it('anonymous roster keeps every status, builds avatar URLs, drops Q2 fields', async () => {
    const res = await get(`/events/${f.eventId}/roster`);
    const body = res.body as RosterBody;
    const member = await get(`/events/${f.eventId}/roster`, f.memberToken);
    const statuses = (b: RosterBody) => b.signups.map((s) => s.status).sort();
    // The privacy property: the projection neither adds nor drops a status.
    expect({ anonymous: statuses(body) }).toEqual({
      anonymous: statuses(member.body as RosterBody),
    });
    expect(statuses(member.body as RosterBody)).toEqual(ROSTER_STATUSES);
    const byName = new Map(body.signups.map((s) => [s.user.username, s]));
    expect(byName.get('linked')?.user.avatar).toBe(
      `${CDN}/${LINKED_SNOWFLAKE}/abcdef.png`,
    );
    expect(byName.get('guestie')?.user.avatar).toBe(
      `${CDN}/${ANON_SNOWFLAKE}/hash9.png`,
    );
    expect(byName.get('unl')?.user.avatar).toBeNull();
    expect(byName.get('linked')).not.toHaveProperty('note');
    expect(byName.get('linked')).not.toHaveProperty('runningLateAt');
  });

  it('anonymous assignments carry the server-built avatar URL', async () => {
    const res = await get(`/events/${f.eventId}/roster/assignments`);
    const linked = (res.body as AssignmentsBody).assignments.find(
      (a) => a.username === 'linked',
    );
    expect(linked?.avatar).toBe(`${CDN}/${LINKED_SNOWFLAKE}/abcdef.png`);
  });

  it.each([
    ['member', () => f.memberToken],
    ['admin', () => adminToken],
  ] as const)(
    'a signed-in %s keeps the full member payload',
    async (_label, token) => {
      const roster = await get(`/events/${f.eventId}/roster`, token());
      const linked = (roster.body as RosterBody).signups.find(
        (s) => s.user.username === 'linked',
      );
      expect(linked?.user.discordId).toBe(LINKED_SNOWFLAKE);
      expect(linked?.note).toBe('private note');
      const detail = await get(`/events/${f.eventId}/detail`, token());
      expect(
        (detail.body as { event: { creator: { discordId?: string } } }).event
          .creator.discordId,
      ).toBe(LINKED_SNOWFLAKE);
      const assignments = await get(
        `/events/${f.eventId}/roster/assignments`,
        token(),
      );
      expect(forbiddenPaths(assignments.body)).toContain(
        '$.assignments[0].discordId',
      );
    },
  );

  it.each([
    ['anonymous', undefined],
    ['deactivated', 'deactivated'],
  ] as const)(
    'a %s caller of the detail bundle gets no PUG invite, Discord or guild field',
    async (_label, who) => {
      await seedPugSlot(f.eventId);
      const token = who ? f.deactivatedToken : undefined;
      const res = await get(`/events/${f.eventId}/detail`, token);
      expect(res.status).toBe(200);
      const body = res.body as DetailBody;
      expect(pugMemberFields(body)).toEqual([PUG_BLANK_FIELDS]);
      expect(body.voiceChannel?.guildId ?? null).toBeNull();
    },
  );

  it('a signed-in member of the detail bundle keeps the PUG invite + Discord fields', async () => {
    await seedPugSlot(f.eventId);
    const res = await get(`/events/${f.eventId}/detail`, f.memberToken);
    expect(res.status).toBe(200);
    expect(pugMemberFields(res.body as DetailBody)).toEqual([
      PUG_MEMBER_FIELDS,
    ]);
  });

  it('roster availability stays members-only (PR #1388 regression)', async () => {
    const res = await get(`/events/${f.eventId}/roster/availability`);
    expect(res.status).toBe(401);
  });
});
