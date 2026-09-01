/**
 * ROK-1314 AC7 — viewer personalization on the GameDetailDto path.
 *
 * `GET /games/:id` is deliberately UNGUARDED (see igdb.controller.ts), so it is
 * the route that proves spec §4.5's anonymous contract end to end:
 *
 *   no authenticated viewer => { currentUserOwns: false, currentUserWishlisted: false }
 *   never `undefined`, never a thrown 401, never another user's flag.
 *
 * TDD: written before the implementation. Every `currentUser*` assertion fails
 * today because `GameDetailSchema` does not carry the fields yet (spec §3.1).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

interface PersonalizedGameDetail {
  id: number;
  name: string;
  currentUserOwns?: boolean;
  currentUserWishlisted?: boolean;
  ownerCount?: number;
  wishlistCount?: number;
}

function describeGameDetailPersonalization() {
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

  async function insertGame(
    name: string,
  ): Promise<typeof schema.games.$inferSelect> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
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

  /** GET /games/:id with an optional bearer token. */
  async function fetchDetail(
    gameId: number,
    token?: string,
  ): Promise<{ status: number; body: PersonalizedGameDetail }> {
    const req = testApp.request.get(`/games/${gameId}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req;
    return { status: res.status, body: res.body as PersonalizedGameDetail };
  }

  it('flags the authenticated owner of the game', async () => {
    const game = await insertGame('Detail Owned');
    await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');

    const { status, body } = await fetchDetail(game.id, adminToken);

    expect(status).toBe(200);
    expect(body.currentUserOwns).toBe(true);
    expect(body.currentUserWishlisted).toBe(false);
  });

  it('flags the authenticated wishlister of the game', async () => {
    const game = await insertGame('Detail Wishlisted');
    const member = await loginAsMember('detail-wishlister');
    await addInterest(member.userId, game.id, 'steam_wishlist');

    const { status, body } = await fetchDetail(game.id, member.token);

    expect(status).toBe(200);
    expect(body.currentUserWishlisted).toBe(true);
    expect(body.currentUserOwns).toBe(false);
  });

  it('returns explicit false flags for an authenticated non-owner', async () => {
    const game = await insertGame('Detail Non Owner');
    const bystander = await loginAsMember('detail-bystander');
    // Someone else owns AND wishlists it — neither may leak to the bystander.
    await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');
    await addInterest(testApp.seed.adminUser.id, game.id, 'steam_wishlist');

    const { status, body } = await fetchDetail(game.id, bystander.token);

    expect(status).toBe(200);
    expect(body.currentUserOwns).toBe(false);
    expect(body.currentUserWishlisted).toBe(false);
  });

  it('returns 200 with both flags false for an anonymous viewer (spec §4.5)', async () => {
    const game = await insertGame('Detail Anonymous');
    await addInterest(testApp.seed.adminUser.id, game.id, 'steam_library');
    await addInterest(testApp.seed.adminUser.id, game.id, 'steam_wishlist');

    const { status, body } = await fetchDetail(game.id);

    // Never a 401 — the public /games index hits this path.
    expect(status).toBe(200);
    // Never `undefined` — the client must be able to read a boolean.
    expect(body.currentUserOwns).toBe(false);
    expect(body.currentUserWishlisted).toBe(false);
  });

  it('a manual heart alone does not set currentUserOwns (edge case §7.7)', async () => {
    const game = await insertGame('Detail Hearted Only');
    const hearter = await loginAsMember('detail-hearter');
    await addInterest(hearter.userId, game.id, 'manual');

    const { body } = await fetchDetail(game.id, hearter.token);

    expect(body.currentUserOwns).toBe(false);
    expect(body.currentUserWishlisted).toBe(false);
  });

  it('owning AND wishlisting the same game sets both flags (edge case §7.2)', async () => {
    const game = await insertGame('Detail Owned And Wishlisted');
    const member = await loginAsMember('detail-both');
    await addInterest(member.userId, game.id, 'steam_library');
    await addInterest(member.userId, game.id, 'steam_wishlist');

    const { body } = await fetchDetail(game.id, member.token);

    expect(body.currentUserOwns).toBe(true);
    expect(body.currentUserWishlisted).toBe(true);
  });

  /**
   * ROK-1314 follow-up (operator-requested 2026-09-01): the aggregate owner /
   * wishlist counts must reach the `GameDetailDto` surfaces too, so a Library
   * card can render `[You own] [N own]` and not just the personalized pill.
   *
   * These MUST be served on the PUBLIC path. AC4 requires aggregates to render
   * for an anonymous visitor, and both interest endpoints
   * (`/games/:id/interest`, `/games/interest/batch`) are JWT-guarded — so the
   * aggregate cannot come from there.
   */
  describe('aggregate owner / wishlist counts', () => {
    it('returns the steam_library owner count to an authenticated viewer', async () => {
      const game = await insertGame('Aggregate Owned Game');
      const a = await loginAsMember('agg-owner-a');
      const b = await loginAsMember('agg-owner-b');
      await addInterest(a.userId, game.id, 'steam_library');
      await addInterest(b.userId, game.id, 'steam_library');

      const { body } = await fetchDetail(game.id, a.token);

      expect(body.ownerCount).toBe(2);
      expect(body.currentUserOwns).toBe(true);
    });

    it('returns the same aggregate to an ANONYMOUS viewer, with both flags false', async () => {
      const game = await insertGame('Aggregate Anonymous Game');
      const a = await loginAsMember('agg-anon-a');
      await addInterest(a.userId, game.id, 'steam_library');
      await addInterest(a.userId, game.id, 'steam_wishlist');

      const { status, body } = await fetchDetail(game.id);

      expect(status).toBe(200);
      expect(body.ownerCount).toBe(1);
      expect(body.wishlistCount).toBe(1);
      expect(body.currentUserOwns).toBe(false);
      expect(body.currentUserWishlisted).toBe(false);
    });

    it('does not count a manual heart as ownership in the aggregate', async () => {
      const game = await insertGame('Aggregate Manual Heart Game');
      const a = await loginAsMember('agg-manual-a');
      await addInterest(a.userId, game.id, 'manual');

      const { body } = await fetchDetail(game.id);

      expect(body.ownerCount).toBe(0);
      expect(body.wishlistCount).toBe(0);
    });

    it('reports zero rather than omitting the field for a game nobody owns', async () => {
      const game = await insertGame('Aggregate Untouched Game');
      const { body } = await fetchDetail(game.id);
      expect(body.ownerCount).toBe(0);
      expect(body.wishlistCount).toBe(0);
    });
  });
}

describe('ROK-1314 GameDetailDto personalization (integration)', () =>
  describeGameDetailPersonalization());
