/**
 * Weekly digest "🏷 Best price" read against a real database (ROK-1771 §11).
 *
 * Also pins the discover "Best Price" row (`fetchBestPriceRow`), because the
 * predicate was extracted into the shared `bestPriceCondition()` and the
 * row's unit spec mocks the query builder (so never sees the WHERE clause).
 */
import type Redis from 'ioredis';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { fetchBestPriceRow } from '../igdb/igdb-discover-deals.helpers';
import { fetchWishlistedBestPrice } from './weekly-digest-best-price.helpers';

interface Pricing {
  cut: number | null;
  price: string | null;
  lowest: string | null;
}

/** At the all-time low with a real discount. */
const AT_LOW: Pricing = { cut: 60, price: '11.99', lowest: '11.99' };

let testApp: TestApp;
let seq = 0;

/** Stamps that make a user no longer an active member (AC10). */
type InactiveStamp = { deactivatedAt?: Date; bannedAt?: Date; kickedAt?: Date };

async function seedUser(stamp: InactiveStamp = {}): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `d:bp-${seq}`,
        username: `bp-${seq}`,
        role: 'member',
        ...stamp,
      })
      .returning(),
    'user',
  );
  return u.id;
}

async function seedGame(name: string, p: Pricing): Promise<number> {
  seq += 1;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: `bp-${seq}`,
        itadGameId: `itad-bp-${seq}`,
        itadCurrentCut: p.cut,
        itadCurrentPrice: p.price,
        itadLowestPrice: p.lowest,
      })
      .returning(),
    'game',
  );
  return g.id;
}

async function wishlist(
  gameId: number,
  userIds: number[],
  source = 'steam_wishlist',
): Promise<void> {
  await testApp.db
    .insert(schema.gameInterests)
    .values(userIds.map((userId) => ({ userId, gameId, source })));
}

async function seedUsers(n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) ids.push(await seedUser());
  return ids;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('fetchWishlistedBestPrice — eligibility (ROK-1771 §11)', () => {
  it('includes only wishlisted games at their all-time low', async () => {
    const users = await seedUsers(2);
    const hit = await seedGame('At Low', AT_LOW);
    const discounted = await seedGame('Just Discounted', {
      cut: 40,
      price: '19.99',
      lowest: '11.99',
    });
    const notWishlisted = await seedGame('Nobody Wants', AT_LOW);
    const noCut = await seedGame('Full Price', {
      cut: 0,
      price: '9.99',
      lowest: '9.99',
    });
    const nullCurrent = await seedGame('No Current', {
      ...AT_LOW,
      price: null,
    });
    const nullLowest = await seedGame('No Lowest', { ...AT_LOW, lowest: null });
    for (const id of [hit, discounted, noCut, nullCurrent, nullLowest]) {
      await wishlist(id, users);
    }
    await wishlist(notWishlisted, users, 'steam_library');

    const section = await fetchWishlistedBestPrice(testApp.db);

    expect(section.items.map((l) => l.name)).toEqual(['At Low']);
    expect(section.total).toBe(1);
    expect(section.items[0]).toEqual({
      gameId: hit,
      name: 'At Low',
      slug: expect.stringMatching(/^bp-/) as unknown,
      cutPercent: 60,
      price: 11.99,
      wishlisters: 2,
    });
  });

  it('returns an empty section when nothing qualifies', async () => {
    const users = await seedUsers(1);
    const id = await seedGame('Just Discounted', {
      cut: 40,
      price: '19.99',
      lowest: '11.99',
    });
    await wishlist(id, users);

    await expect(fetchWishlistedBestPrice(testApp.db)).resolves.toEqual({
      items: [],
      total: 0,
    });
  });
});

/** One opted-out user plus one deactivated, one banned and one kicked. */
async function seedUncountedUsers(): Promise<number[]> {
  const optedOut = await seedUser();
  await testApp.db
    .insert(schema.userPreferences)
    .values({ userId: optedOut, key: 'show_activity', value: false });
  const at = new Date();
  return [
    optedOut,
    await seedUser({ deactivatedAt: at }),
    await seedUser({ bannedAt: at }),
    await seedUser({ kickedAt: at }),
  ];
}

describe('fetchWishlistedBestPrice — who counts (AC10)', () => {
  it('opted-out and inactive members neither count nor qualify a game', async () => {
    const active = await seedUsers(2);
    const uncounted = await seedUncountedUsers();
    const counted = await seedGame('Counted', AT_LOW);
    const onlyGone = await seedGame('Only Gone', AT_LOW);
    await wishlist(counted, [...active, ...uncounted]);
    await wishlist(onlyGone, uncounted);

    const section = await fetchWishlistedBestPrice(testApp.db);

    expect(section.items.map((l) => [l.name, l.wishlisters])).toEqual([
      ['Counted', 2],
    ]);
    expect(section.total).toBe(1);
  });
});

describe('fetchWishlistedBestPrice — order and limit (ROK-1771 §11)', () => {
  it('orders by distinct wishlisters, then cut; top 3 with full total', async () => {
    const users = await seedUsers(4);
    const two50 = await seedGame('Two at 50', { ...AT_LOW, cut: 50 });
    const two80 = await seedGame('Two at 80', { ...AT_LOW, cut: 80 });
    const four = await seedGame('Four', { ...AT_LOW, cut: 10 });
    const one = await seedGame('One', { ...AT_LOW, cut: 90 });
    await wishlist(two50, users.slice(0, 2));
    await wishlist(two80, users.slice(0, 2));
    await wishlist(four, users);
    await wishlist(one, users.slice(0, 1));
    // A non-wishlist interest must not inflate the wishlister count.
    await wishlist(one, users.slice(1, 4), 'manual');

    const section = await fetchWishlistedBestPrice(testApp.db, 3);

    expect(
      section.items.map((l) => [l.name, l.wishlisters, l.cutPercent]),
    ).toEqual([
      ['Four', 4, 10],
      ['Two at 80', 2, 80],
      ['Two at 50', 2, 50],
    ]);
    expect(section.total).toBe(4);
  });
});

describe('fetchBestPriceRow — shared predicate unchanged (ROK-803)', () => {
  const redis = {
    get: () => Promise.resolve(null),
    setex: () => Promise.resolve('OK'),
  } as unknown as Redis;

  it('keeps games at their low and drops above-low, cut-0 and null prices', async () => {
    await seedGame('At Low', AT_LOW);
    await seedGame('Below Low', { cut: 70, price: '9.99', lowest: '11.99' });
    await seedGame('Above Low', { cut: 40, price: '19.99', lowest: '11.99' });
    await seedGame('Cut Zero', { cut: 0, price: '9.99', lowest: '9.99' });
    await seedGame('Null Current', { ...AT_LOW, price: null });
    await seedGame('Null Lowest', { ...AT_LOW, lowest: null });

    const row = await fetchBestPriceRow(testApp.db, redis, 60);

    expect(row.games.map((g) => g.name).sort()).toEqual([
      'At Low',
      'Below Low',
    ]);
  });
});
