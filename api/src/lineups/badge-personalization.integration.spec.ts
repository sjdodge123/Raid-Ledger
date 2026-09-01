/**
 * ROK-1314 AC7 — viewer personalization on the two lineup DTO paths.
 *
 * Covers `currentUserOwns` / `currentUserWishlisted` for owner vs wishlister
 * vs uninvolved viewer on:
 *   • GET /lineups/common-ground  (CommonGroundGameDto — spec §3.2 / §4.1)
 *   • GET /lineups/:id            (LineupEntryResponseDto — spec §3.3 / §4.2)
 *
 * Ownership semantics are fixed by spec §2 decision 4:
 *   currentUserOwns       <=> game_interests.source = 'steam_library'
 *   currentUserWishlisted <=> game_interests.source = 'steam_wishlist'
 *   a 'manual' heart is the separate want-to-play concept and is NOT ownership.
 *
 * Both routes sit behind the controller-level JWT guard, so "anonymous" on
 * these two paths means 401 rather than a false-flag body. The anonymous
 * false-not-undefined contract from spec §4.5 is exercised on the unguarded
 * GameDetailDto route in `igdb/game-detail-personalization.integration.spec.ts`.
 * What IS asserted here is the other half of §4.5: a viewer must never see
 * ANOTHER user's flag leak through the aggregate query.
 *
 * TDD: written before the implementation. Every `currentUser*` assertion below
 * fails today because the field is absent from the response.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

interface PersonalizedGame {
  gameId: number;
  ownerCount: number;
  wishlistCount: number;
  currentUserOwns?: boolean;
  currentUserWishlisted?: boolean;
}

interface PersonalizedEntry {
  gameId: number;
  ownerCount: number;
  wishlistCount: number;
  itadLowestPrice?: number | null;
  currentUserOwns?: boolean;
  currentUserWishlisted?: boolean;
}

function describeBadgePersonalization() {
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

  // ── Fixtures ─────────────────────────────────────────────────

  /** Create a `member` user with local credentials and log them in. */
  async function loginAsMember(
    handle: string,
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('MemberPass1!', 4);
    const email = `${handle}@test.local`;
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: handle,
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'MemberPass1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createBuildingLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'ROK-1314 Badge Personalization' });
    if (res.status !== 201) {
      throw new Error(
        `createBuildingLineup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.id as number;
  }

  async function insertGame(
    overrides: Partial<typeof schema.games.$inferInsert> = {},
  ): Promise<typeof schema.games.$inferSelect> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'ROK-1314 Badge Game',
        slug: overrides.slug ?? `rok1314-${Date.now()}-${Math.random()}`,
        steamAppId:
          overrides.steamAppId ?? Math.floor(Math.random() * 900000) + 100000,
        ...overrides,
      })
      .returning();
    return game;
  }

  async function addInterest(
    userId: number,
    gameId: number,
    source: 'steam_library' | 'steam_wishlist' | 'manual',
  ): Promise<void> {
    await testApp.db
      .insert(schema.gameInterests)
      .values({ userId, gameId, source });
  }

  async function fetchCommonGround(
    token: string,
    gameId: number,
  ): Promise<PersonalizedGame> {
    const res = await testApp.request
      .get('/lineups/common-ground')
      .set('Authorization', `Bearer ${token}`)
      .query({ minOwners: 1 });
    expect(res.status).toBe(200);
    const row = (res.body.data as PersonalizedGame[]).find(
      (g) => g.gameId === gameId,
    );
    expect(row).toBeDefined();
    return row!;
  }

  async function fetchEntry(
    token: string,
    lineupId: number,
    gameId: number,
  ): Promise<PersonalizedEntry> {
    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const entry = (res.body.entries as PersonalizedEntry[]).find(
      (e) => e.gameId === gameId,
    );
    expect(entry).toBeDefined();
    return entry!;
  }

  // ── GET /lineups/common-ground (spec §4.1) ───────────────────

  function describeCommonGroundPersonalization() {
    it('flags the viewer who owns the game via steam_library', async () => {
      await createBuildingLineup();
      const game = await insertGame({ name: 'Owned By Admin' });
      await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');

      const row = await fetchCommonGround(adminToken, game.id);

      expect(row.currentUserOwns).toBe(true);
      expect(row.currentUserWishlisted).toBe(false);
      // Personalization is ADDITIVE — the aggregate must survive (spec §5.1).
      expect(row.ownerCount).toBe(1);
    });

    it('flags the viewer who has the game on their steam wishlist', async () => {
      await createBuildingLineup();
      const game = await insertGame({ name: 'Wishlisted By Member' });
      const member = await loginAsMember('cg-wishlister');
      // A second user owns it so the row clears the minOwners filter.
      await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');
      await addInterest(member.userId, game.id, 'steam_wishlist');

      const row = await fetchCommonGround(member.token, game.id);

      expect(row.currentUserWishlisted).toBe(true);
      expect(row.currentUserOwns).toBe(false);
      expect(row.wishlistCount).toBe(1);
    });

    it('returns both flags false for a viewer with no interest in the game', async () => {
      await createBuildingLineup();
      const game = await insertGame({ name: 'Owned By Someone Else' });
      const bystander = await loginAsMember('cg-bystander');
      await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');

      const row = await fetchCommonGround(bystander.token, game.id);

      // Never `undefined` — spec §4.5 requires an explicit false.
      expect(row.currentUserOwns).toBe(false);
      expect(row.currentUserWishlisted).toBe(false);
      // …and the OTHER user's ownership still shows in the aggregate.
      expect(row.ownerCount).toBe(1);
    });

    it("does not leak another viewer's flags: two viewers, one row, different answers", async () => {
      await createBuildingLineup();
      const game = await insertGame({ name: 'Two Viewers One Row' });
      const wishlister = await loginAsMember('cg-two-viewers');
      await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');
      await addInterest(wishlister.userId, game.id, 'steam_wishlist');

      const asOwner = await fetchCommonGround(adminToken, game.id);
      const asWishlister = await fetchCommonGround(wishlister.token, game.id);

      expect(asOwner.currentUserOwns).toBe(true);
      expect(asOwner.currentUserWishlisted).toBe(false);
      expect(asWishlister.currentUserOwns).toBe(false);
      expect(asWishlister.currentUserWishlisted).toBe(true);
    });

    it('a manual heart is not ownership (spec §2 decision 4, edge case §7.7)', async () => {
      await createBuildingLineup();
      const game = await insertGame({ name: 'Hearted Not Owned' });
      const hearter = await loginAsMember('cg-hearter');
      await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');
      await addInterest(hearter.userId, game.id, 'manual');

      const row = await fetchCommonGround(hearter.token, game.id);

      expect(row.currentUserOwns).toBe(false);
      expect(row.currentUserWishlisted).toBe(false);
    });
  }

  // ── GET /lineups/:id entries (spec §4.2) ─────────────────────

  function describeLineupEntryPersonalization() {
    /** Nominate `gameId` into `lineupId` directly at the DB level. */
    async function nominate(lineupId: number, gameId: number): Promise<void> {
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId,
        gameId,
        nominatedBy: testApp.seed.adminUser.id,
      });
    }

    it('flags the nomination the viewer owns via steam_library', async () => {
      const lineupId = await createBuildingLineup();
      const game = await insertGame({ name: 'Entry Owned By Admin' });
      await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');
      await nominate(lineupId, game.id);

      const entry = await fetchEntry(adminToken, lineupId, game.id);

      expect(entry.currentUserOwns).toBe(true);
      expect(entry.currentUserWishlisted).toBe(false);
      expect(entry.ownerCount).toBe(1);
    });

    it('flags the nomination the viewer wishlisted', async () => {
      const lineupId = await createBuildingLineup();
      const game = await insertGame({ name: 'Entry Wishlisted' });
      const member = await loginAsMember('entry-wishlister');
      await addInterest(member.userId, game.id, 'steam_wishlist');
      await nominate(lineupId, game.id);

      const entry = await fetchEntry(member.token, lineupId, game.id);

      expect(entry.currentUserWishlisted).toBe(true);
      expect(entry.currentUserOwns).toBe(false);
    });

    it('returns explicit false flags for an uninvolved viewer', async () => {
      const lineupId = await createBuildingLineup();
      const game = await insertGame({ name: 'Entry Bystander' });
      const bystander = await loginAsMember('entry-bystander');
      await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');
      await nominate(lineupId, game.id);

      const entry = await fetchEntry(bystander.token, lineupId, game.id);

      expect(entry.currentUserOwns).toBe(false);
      expect(entry.currentUserWishlisted).toBe(false);
      expect(entry.ownerCount).toBe(1);
    });

    it('surfaces itadLowestPrice so the card can resolve best-price (spec §3.3)', async () => {
      const lineupId = await createBuildingLineup();
      const game = await insertGame({
        name: 'Entry With Lowest Price',
        itadCurrentPrice: 19.99,
        itadCurrentCut: 40,
        itadLowestPrice: 9.99,
      });
      await nominate(lineupId, game.id);

      const entry = await fetchEntry(adminToken, lineupId, game.id);

      expect(entry.itadLowestPrice).toBeCloseTo(9.99, 2);
    });
  }

  describe('GET /lineups/common-ground — viewer personalization', () =>
    describeCommonGroundPersonalization());
  describe('GET /lineups/:id entries — viewer personalization', () =>
    describeLineupEntryPersonalization());
}

describe('ROK-1314 badge personalization (integration)', () =>
  describeBadgePersonalization());
