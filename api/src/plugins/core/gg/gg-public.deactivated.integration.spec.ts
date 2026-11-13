/**
 * ROK-2187 — a shared GG stops being public the moment its owner is
 * deactivated (left the guild): `GET /gg/public/:slug` 404s. Kept in its own
 * file so it does not collide with the share/public lane's edits.
 */
import type { GgSnapshotV1 } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';

const YEAR = 2026;
let testApp: TestApp;

function payload(): GgSnapshotV1 {
  return {
    schemaVersion: 1,
    year: YEAR,
    window: { from: `${YEAR}-01-01T00:00:00Z`, to: `${YEAR}-12-10T12:00:00Z` },
    tier: 'full',
    computedAt: `${YEAR}-12-10T12:00:00Z`,
    cards: [
      {
        pluginSlug: 'core',
        cardId: 'summary',
        order: 1300,
        payload: {
          eventsAttended: 3,
          hoursPlayedSeconds: 3600,
          topGames: [],
          playedWithCount: 2,
          superlative: null,
        },
      },
    ],
  };
}

async function sharedOwner(): Promise<{ id: number; slug: string }> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: '900777001', username: 'leaver', role: 'member' })
      .returning({ id: schema.users.id }),
    'gg owner',
  );
  await testApp.db.insert(schema.ggSnapshots).values({
    userId: u.id,
    year: YEAR,
    schemaVersion: 1,
    payload: payload(),
    activityTier: 'full',
    computedAt: new Date(`${YEAR}-12-10T12:00:00Z`),
  });
  const token = await signTestAccessToken(testApp, {
    sub: u.id,
    username: 'leaver',
  });
  const res = await testApp.request
    .put(`/gg/${YEAR}/share`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ shared: true });
  expect(res.status).toBe(200);
  return { id: u.id, slug: String(res.body.slug) };
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

it('a deactivated owner’s shared GG 404s publicly', async () => {
  const owner = await sharedOwner();
  // Live first, so the 404 below is the deactivation and not the fixture.
  expect((await testApp.request.get(`/gg/public/${owner.slug}`)).status).toBe(
    200,
  );
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: new Date() })
    .where(eq(schema.users.id, owner.id));
  expect((await testApp.request.get(`/gg/public/${owner.slug}`)).status).toBe(
    404,
  );
});
