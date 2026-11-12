/**
 * ROK-2187 lane 6a — GG snapshot compute + owner/public API against a real
 * database: the read returns the STORED payload (no recompute, AC1), the
 * archive lists years (AC7), sharing is opt-in with a rotating slug and the
 * public read is the Summary allow-list only (AC8, Q4), and `computeAll`
 * skips deactivated users and writes nothing for a user with no activity.
 */
import {
  GgArchiveDtoSchema,
  GgOwnerSnapshotDtoSchema,
  type GgSnapshotV1,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import { GgComputeService } from './gg-compute.service';

const PUBLIC_KEYS = [
  'avatarUrl',
  'displayName',
  'eventsAttended',
  'hoursPlayedSeconds',
  'playedWithCount',
  'superlative',
  'topGames',
  'year',
].sort();
const NOW = new Date('2026-12-10T12:00:00Z');
let testApp: TestApp;
let seq = 0;

interface Who {
  id: number;
  token: string;
}

async function insertUser(name: string, deactivated = false): Promise<Who> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `90000${(seq += 1)}`,
        username: name,
        displayName: `${name} D`,
        role: 'member',
        deactivatedAt: deactivated ? new Date() : null,
      })
      .returning({ id: schema.users.id }),
    name,
  );
  const token = await signTestAccessToken(testApp, {
    sub: u.id,
    username: name,
  });
  return { id: u.id, token };
}

/** A stored payload whose numbers exist nowhere else in the database. */
function payload(year: number): GgSnapshotV1 {
  return {
    schemaVersion: 1,
    year,
    window: { from: `${year}-01-01T00:00:00Z`, to: `${year}-12-10T12:00:00Z` },
    tier: 'full',
    computedAt: `${year}-12-10T12:00:00Z`,
    cards: [
      {
        pluginSlug: 'core',
        cardId: 'people',
        order: 900,
        payload: {
          people: [
            {
              userId: 4242,
              displayName: 'SecretFriend',
              avatarUrl: null,
              sharedEvents: 3,
              sharedVoiceSeconds: 60,
            },
          ],
          playedWithCount: 7,
        },
      },
      {
        pluginSlug: 'core',
        cardId: 'summary',
        order: 1300,
        payload: {
          eventsAttended: 42,
          hoursPlayedSeconds: 7200,
          topGames: [
            {
              gameId: testApp.seed.game.id,
              name: 'Stored Game',
              coverUrl: null,
            },
          ],
          playedWithCount: 7,
          superlative: null,
        },
      },
    ],
  };
}

async function storeSnapshot(userId: number, year: number): Promise<void> {
  await testApp.db.insert(schema.ggSnapshots).values({
    userId,
    year,
    schemaVersion: 1,
    payload: payload(year),
    activityTier: 'full',
    computedAt: new Date(`${year}-12-10T12:00:00Z`),
  });
}

const auth = (w: Who): Record<string, string> => ({
  Authorization: `Bearer ${w.token}`,
});

async function share(w: Who, year: number, shared: boolean) {
  return testApp.request.put(`/gg/${year}/share`).set(auth(w)).send({ shared });
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('GET /gg/:year and /gg/archive (owner)', () => {
  it('returns the stored payload as-is, without recomputing', async () => {
    const me = await insertUser('owner');
    await storeSnapshot(me.id, 2026);
    const res = await testApp.request.get('/gg/2026').set(auth(me));
    expect(res.status).toBe(200);
    const body = GgOwnerSnapshotDtoSchema.parse(res.body);
    const summary = body.cards.find((c) => c.cardId === 'summary');
    expect(summary?.payload).toMatchObject({ eventsAttended: 42 });
    expect(body.tier).toBe('full');
    expect(body.share).toEqual({ shared: false, slug: null, sharedAt: null });
  });

  it('404s for a year without a snapshot and requires a token', async () => {
    const me = await insertUser('nosnap');
    expect((await testApp.request.get('/gg/2026').set(auth(me))).status).toBe(
      404,
    );
    expect((await testApp.request.get('/gg/2026')).status).toBe(401);
  });

  it('lists every year with a snapshot, newest first, own rows only', async () => {
    const me = await insertUser('archivist');
    const other = await insertUser('other');
    await storeSnapshot(me.id, 2025);
    await storeSnapshot(me.id, 2026);
    await storeSnapshot(other.id, 2024);
    const res = await testApp.request.get('/gg/archive').set(auth(me));
    expect(res.status).toBe(200);
    const years = GgArchiveDtoSchema.parse(res.body).years.map((y) => y.year);
    expect(years).toEqual([2026, 2025]);
    const read = await testApp.request.get('/gg/2025').set(auth(me));
    expect(read.body.archiveYears).toEqual([2026, 2025]);
  });
});

describe('PUT /gg/:year/share + GET /gg/public/:slug', () => {
  it('is off by default, on → public summary allow-list only', async () => {
    const me = await insertUser('sharer');
    await storeSnapshot(me.id, 2026);
    const on = await share(me, 2026, true);
    expect(on.status).toBe(200);
    expect(on.body.slug).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    const pub = await testApp.request.get(`/gg/public/${on.body.slug}`);
    expect(pub.status).toBe(200);
    expect(Object.keys(pub.body as object).sort()).toEqual(PUBLIC_KEYS);
    expect(pub.body.eventsAttended).toBe(42);
    expect(pub.body.playedWithCount).toBe(7);
    expect(pub.body.topGames).toEqual([
      { name: 'Stored Game', coverUrl: null },
    ]);
    const raw = JSON.stringify(pub.body);
    expect(raw).not.toContain('SecretFriend');
    expect(raw).not.toMatch(/"(userId|id|discordId|email|username)"/);
  });

  it('off → public 404; re-share mints a NEW slug', async () => {
    const me = await insertUser('rotator');
    await storeSnapshot(me.id, 2026);
    const first = (await share(me, 2026, true)).body.slug as string;
    const off = await share(me, 2026, false);
    expect(off.body).toEqual({ shared: false, slug: null, sharedAt: null });
    expect((await testApp.request.get(`/gg/public/${first}`)).status).toBe(404);
    const second = (await share(me, 2026, true)).body.slug as string;
    expect(second).not.toBe(first);
    expect((await testApp.request.get(`/gg/public/${second}`)).status).toBe(
      200,
    );
    expect((await testApp.request.get(`/gg/public/${first}`)).status).toBe(404);
  });

  it('404s when sharing a year without a snapshot', async () => {
    const me = await insertUser('empty');
    expect((await share(me, 2026, true)).status).toBe(404);
  });
});

describe('GgComputeService.computeAll', () => {
  async function attendedEvent(userId: number): Promise<void> {
    const start = new Date('2026-03-14T00:00:00Z');
    const [e] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({
          title: `E ${userId}`,
          creatorId: userId,
          gameId: testApp.seed.game.id,
          duration: [start, new Date(start.getTime() + 7_200_000)],
        })
        .returning({ id: schema.events.id }),
      'event',
    );
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId: e.id, userId, attendanceStatus: 'attended' });
  }

  async function rowsFor(userId: number) {
    return testApp.db
      .select()
      .from(schema.ggSnapshots)
      .where(eq(schema.ggSnapshots.userId, userId));
  }

  it('stores active users with activity, skips deactivated and idle users', async () => {
    const active = await insertUser('active');
    const gone = await insertUser('gone', true);
    const idle = await insertUser('idle');
    await attendedEvent(active.id);
    await attendedEvent(gone.id);
    const result = await testApp.app
      .get(GgComputeService)
      .computeAll(2026, NOW);
    const [row] = await rowsFor(active.id);
    expect(row?.year).toBe(2026);
    expect(row?.payload.cards.some((c) => c.cardId === 'events')).toBe(true);
    expect(await rowsFor(gone.id)).toHaveLength(0);
    expect(await rowsFor(idle.id)).toHaveLength(0);
    expect(result.deactivated).toBeGreaterThanOrEqual(1);
    expect(result.noActivity).toBeGreaterThanOrEqual(1);
    expect(result.computed).toBe(1);
  });

  it('recomputing keeps one row per user/year and its share slug', async () => {
    const me = await insertUser('again');
    await attendedEvent(me.id);
    const svc = testApp.app.get(GgComputeService);
    await svc.computeAll(2026, NOW);
    const slug = (await share(me, 2026, true)).body.slug as string;
    await svc.computeAll(2026, new Date('2026-12-11T12:00:00Z'));
    const rows = await rowsFor(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shareSlug).toBe(slug);
    expect(rows[0]?.computedAt.toISOString()).toBe('2026-12-11T12:00:00.000Z');
  });
});
