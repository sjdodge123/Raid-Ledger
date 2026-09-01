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
}

describe('ROK-1314 GameDetailDto personalization (integration)', () =>
  describeGameDetailPersonalization());
