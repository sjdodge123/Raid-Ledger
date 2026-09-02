/**
 * ROK-1314 §4.4 — badge data on veto tiebreaker cards.
 *
 * Veto cards render the COMPACT badge set (spec §5.3): owner/wishlist
 * aggregates, the viewer's own two flags, and the three price scalars.
 *
 * Asserts the same §4.5 contract the other two paths carry:
 *   • no viewer            => both flags explicit `false`, never `undefined`
 *   • another user's flags => never leak into this viewer's card
 *   • a `manual` heart     => NOT ownership (§7.7)
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { buildVetoStatus } from './tiebreaker-veto.helpers';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;

function describeVetoBadges() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function insertGame(
    overrides: Partial<typeof schema.games.$inferInsert> = {},
  ): Promise<typeof schema.games.$inferSelect> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'ROK-1314 Veto Game',
        slug: `rok1314-veto-${Date.now()}-${Math.random()}`,
        ...overrides,
      })
      .returning();
    return game;
  }

  async function insertMember(handle: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${handle}-${Date.now()}`,
        username: handle,
        role: 'member',
      })
      .returning();
    return user.id;
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

  /** Minimal pending veto tiebreaker over `tiedGameIds`. */
  async function insertTiebreaker(
    tiedGameIds: number[],
  ): Promise<TiebreakerRow> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1314 Veto Badges',
        status: 'voting',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: generatePublicSlug(),
      })
      .returning();
    const [tb] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId: lineup.id,
        mode: 'veto',
        status: 'pending',
        tiedGameIds,
        originalVoteCount: 2,
      })
      .returning();
    return tb;
  }

  it('carries aggregates + price scalars and flags the viewing owner', async () => {
    const game = await insertGame({
      name: 'Veto Owned',
      itadCurrentPrice: '19.99',
      itadCurrentCut: 40,
      itadLowestPrice: '9.99',
    });
    const other = await insertGame({ name: 'Veto Other' });
    const owner = await insertMember('veto-owner');
    const bystander = await insertMember('veto-bystander');
    await addInterest(owner, game.id, 'steam_library');
    await addInterest(bystander, game.id, 'steam_wishlist');
    const tb = await insertTiebreaker([game.id, other.id]);

    const status = await buildVetoStatus(testApp.db, tb, owner);
    const card = status.games.find((g) => g.gameId === game.id)!;

    expect(card.ownerCount).toBe(1);
    expect(card.wishlistCount).toBe(1);
    expect(card.currentUserOwns).toBe(true);
    expect(card.currentUserWishlisted).toBe(false);
    expect(card.itadCurrentPrice).toBeCloseTo(19.99, 2);
    expect(card.itadCurrentCut).toBe(40);
    expect(card.itadLowestPrice).toBeCloseTo(9.99, 2);
  });

  it("never leaks another user's flags and emits explicit false when anonymous", async () => {
    const game = await insertGame({ name: 'Veto Leak Check' });
    const other = await insertGame({ name: 'Veto Leak Other' });
    const owner = await insertMember('veto-leak-owner');
    const bystander = await insertMember('veto-leak-bystander');
    await addInterest(owner, game.id, 'steam_library');
    const tb = await insertTiebreaker([game.id, other.id]);

    const asBystander = await buildVetoStatus(testApp.db, tb, bystander);
    const anon = await buildVetoStatus(testApp.db, tb);

    const bystanderCard = asBystander.games.find((g) => g.gameId === game.id)!;
    expect(bystanderCard.currentUserOwns).toBe(false);
    expect(bystanderCard.currentUserWishlisted).toBe(false);
    // …the aggregate still reports the OTHER user's ownership.
    expect(bystanderCard.ownerCount).toBe(1);

    const anonCard = anon.games.find((g) => g.gameId === game.id)!;
    expect(anonCard.currentUserOwns).toBe(false);
    expect(anonCard.currentUserWishlisted).toBe(false);
  });

  it('does not treat a manual heart as ownership (§7.7)', async () => {
    const game = await insertGame({ name: 'Veto Hearted' });
    const other = await insertGame({ name: 'Veto Hearted Other' });
    const hearter = await insertMember('veto-hearter');
    await addInterest(hearter, game.id, 'manual');
    const tb = await insertTiebreaker([game.id, other.id]);

    const status = await buildVetoStatus(testApp.db, tb, hearter);
    const card = status.games.find((g) => g.gameId === game.id)!;

    expect(card.currentUserOwns).toBe(false);
    expect(card.currentUserWishlisted).toBe(false);
    expect(card.ownerCount).toBe(0);
  });
}

describe('ROK-1314 veto card badges (integration)', () => describeVetoBadges());
