/**
 * ROK-2323 — GET /events/:id/ad-hoc-roster projects per viewer, on real DB data.
 *
 * A signed-in member who neither created the event nor administers it must
 * receive NO `discordUserId` / `steamId` / `playerId` / `idKind` key and no
 * SteamID64 anywhere (an anonymous server player's name falls back to
 * `Server player`). The event creator and an admin keep the full detail. A
 * deactivated account is refused.
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
import { createMemberAndLogin } from './signups.integration.spec-helpers';

const SNOWFLAKE = '123456789012345678';
const STEAM_ID = '76561198000000042';
const ID_KEYS = new Set(['discordUserId', 'steamId', 'playerId', 'idKind']);

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

interface Fixture {
  eventId: number;
  ownerToken: string;
  memberToken: string;
  deactivatedToken: string;
}

/** Every JSON path whose key is an owner-only id field, at any depth. */
function idPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value))
    return value.flatMap((v, i) => idPaths(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(ID_KEYS.has(k) ? [`${path}.${k}`] : []),
    ...idPaths(v, `${path}.${k}`),
  ]);
}

async function createAdHocEvent(creatorId: number): Promise<number> {
  const now = new Date();
  const rows = await testApp.db
    .insert(schema.events)
    .values({
      title: 'ROK-2323 roster',
      creatorId,
      duration: [now, new Date(now.getTime() + 3_600_000)] as [Date, Date],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning();
  return nonEmpty(rows, 'ad-hoc event')[0].id;
}

/** A Discord voice row and an anonymous Steam server row named by its id. */
async function seedParticipants(eventId: number): Promise<void> {
  const now = new Date();
  await testApp.db.insert(schema.adHocParticipants).values([
    {
      eventId,
      userId: null,
      discordUserId: SNOWFLAKE,
      discordUsername: 'VoicePlayer',
      discordAvatarHash: 'avatarhash',
      joinedAt: now,
      sessionCount: 1,
    },
    {
      eventId,
      userId: null,
      discordUserId: null,
      steamId: STEAM_ID,
      playerId: STEAM_ID,
      idKind: 'steam',
      source: 'steam',
      inVoice: false,
      onServer: true,
      discordUsername: STEAM_ID,
      joinedAt: now,
      sessionCount: 1,
    },
  ]);
}

async function seedFixture(): Promise<Fixture> {
  const owner = await createMemberAndLogin(testApp, 'own', 'own@test.local');
  const member = await createMemberAndLogin(testApp, 'mem', 'mem@test.local');
  const deact = await createMemberAndLogin(testApp, 'gone', 'gone@test.local');
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: new Date() })
    .where(eq(schema.users.id, deact.userId));
  clearAuthUserCache();
  const eventId = await createAdHocEvent(owner.userId);
  await seedParticipants(eventId);
  return {
    eventId,
    ownerToken: owner.token,
    memberToken: member.token,
    deactivatedToken: deact.token,
  };
}

function getRoster(eventId: number, token: string) {
  return testApp.request
    .get(`/events/${eventId}/ad-hoc-roster`)
    .set('Authorization', `Bearer ${token}`);
}

type Row = Record<string, unknown>;

function rows(body: unknown): Row[] {
  const participants = (body as { participants?: Row[] }).participants;
  if (!participants) throw new Error('roster response has no participants');
  return participants;
}

describe('GET /events/:id/ad-hoc-roster — viewer projection (ROK-2323)', () => {
  it('a non-owner member gets no ids and no SteamID64 name', async () => {
    const f = await seedFixture();
    const res = await getRoster(f.eventId, f.memberToken);
    expect(res.status).toBe(200);
    expect(idPaths(res.body)).toEqual([]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(STEAM_ID);
    expect(text).not.toContain(SNOWFLAKE);
    const names = rows(res.body).map((p) => p.discordUsername);
    expect(names.sort()).toEqual(['Server player', 'VoicePlayer']);
    const voice = rows(res.body).find(
      (p) => p.discordUsername === 'VoicePlayer',
    );
    expect(voice).toMatchObject({ hasDiscord: true, discordAvatarHash: null });
  });

  it('the event creator keeps the Discord and Steam detail', async () => {
    const f = await seedFixture();
    const res = await getRoster(f.eventId, f.ownerToken);
    expect(res.status).toBe(200);
    const server = rows(res.body).find((p) => p.source === 'steam');
    expect(server).toMatchObject({
      steamId: STEAM_ID,
      playerId: STEAM_ID,
      idKind: 'steam',
      discordUsername: STEAM_ID,
      hasDiscord: false,
    });
    const voice = rows(res.body).find((p) => p.discordUserId === SNOWFLAKE);
    expect(voice).toMatchObject({
      discordAvatarHash: 'avatarhash',
      hasDiscord: true,
    });
  });

  it('an admin who did not create the event keeps the detail', async () => {
    const f = await seedFixture();
    const res = await getRoster(f.eventId, adminToken);
    expect(res.status).toBe(200);
    expect(idPaths(res.body).length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).toContain(STEAM_ID);
  });

  it('a deactivated account is refused', async () => {
    const f = await seedFixture();
    const res = await getRoster(f.eventId, f.deactivatedToken);
    expect(res.status).toBe(403);
  });
});
