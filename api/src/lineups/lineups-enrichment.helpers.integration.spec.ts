/**
 * ROK-1252 — TDD failing integration spec for audience-scoped Steam-unlinked
 * helpers.
 *
 * These tests call `countUnlinkedSteamMembers` and `findUnlinkedSteamMembers`
 * with the FUTURE signature `(db, audience: LineupAudience)`. The current
 * helpers on `main` only take `(db)` and run a community-wide query, so this
 * spec is expected to FAIL TypeScript compilation (extra argument) until the
 * dev lands the signature change described in
 * `planning-artifacts/specs/ROK-1252.md`.
 *
 * Once the helper accepts an audience, the integration cases below assert the
 * lineup-scoped behavior (private = creator ∪ invitees, public = community-
 * wide, empty private = short-circuit zero).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import {
  countUnlinkedSteamMembers,
  findUnlinkedSteamMembers,
} from './lineups-enrichment.helpers';

function describeAudienceScopedEnrichment() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ── Fixture helpers ──────────────────────────────────────────

  /** Insert a user with controllable steamId / display name. */
  async function insertUser(opts: {
    username: string;
    steamId: string | null;
    displayName?: string | null;
  }): Promise<typeof schema.users.$inferSelect> {
    const [row] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${opts.username}@test.local`,
        username: opts.username,
        displayName: opts.displayName ?? null,
        steamId: opts.steamId,
        role: 'member',
      })
      .returning();
    return row;
  }

  /**
   * Build a fixture for the "5 community users without steam" scenarios.
   * Returns one creator + two invitees + three non-invitee community users.
   * Steam-linkage is controlled by the caller.
   */
  async function seedSixUserFixture(opts: {
    creatorHasSteam: boolean;
    invitee1HasSteam: boolean;
    invitee2HasSteam: boolean;
    extra1HasSteam: boolean;
    extra2HasSteam: boolean;
    extra3HasSteam: boolean;
  }) {
    const creator = await insertUser({
      username: 'creator',
      displayName: 'Creator',
      steamId: opts.creatorHasSteam ? 'steam-creator' : null,
    });
    const invitee1 = await insertUser({
      username: 'invitee1',
      displayName: 'Invitee One',
      steamId: opts.invitee1HasSteam ? 'steam-inv1' : null,
    });
    const invitee2 = await insertUser({
      username: 'invitee2',
      displayName: 'Invitee Two',
      steamId: opts.invitee2HasSteam ? 'steam-inv2' : null,
    });
    const extra1 = await insertUser({
      username: 'extra1',
      displayName: 'Extra One',
      steamId: opts.extra1HasSteam ? 'steam-x1' : null,
    });
    const extra2 = await insertUser({
      username: 'extra2',
      displayName: 'Extra Two',
      steamId: opts.extra2HasSteam ? 'steam-x2' : null,
    });
    const extra3 = await insertUser({
      username: 'extra3',
      displayName: 'Extra Three',
      steamId: opts.extra3HasSteam ? 'steam-x3' : null,
    });
    return { creator, invitee1, invitee2, extra1, extra2, extra3 };
  }

  // ── Case 1: Public lineup, community-wide ────────────────────

  it('public audience counts every community user without a steam_id', async () => {
    // 5 users without steam (creator + invitee1 + invitee2 + extra1 + extra2),
    // 1 user with steam (extra3). Public audience = community-wide → 5.
    // (testApp.seed.adminUser is also present without a steamId, so the
    //  expected community total is 6: 5 explicit + the seeded admin.)
    const { creator } = await seedSixUserFixture({
      creatorHasSteam: false,
      invitee1HasSteam: false,
      invitee2HasSteam: false,
      extra1HasSteam: false,
      extra2HasSteam: false,
      extra3HasSteam: true,
    });

    const count = await countUnlinkedSteamMembers(testApp.db, {
      visibility: 'public',
      createdBy: creator.id,
      inviteeUserIds: [],
    });

    // 5 explicit unlinked + 1 seeded admin unlinked = 6.
    expect(count).toBe(6);
  });

  // ── Case 2: Private lineup, scoped to invitees + creator ─────

  it('private audience excludes community users outside the invitee+creator set', async () => {
    // Creator + invitee2 lack steam; invitee1 has steam.
    // extra1/extra2/extra3 are all unlinked community members that MUST be
    // excluded from the private count. Expected = 2 (creator + invitee2).
    const { creator, invitee1, invitee2 } = await seedSixUserFixture({
      creatorHasSteam: false,
      invitee1HasSteam: true,
      invitee2HasSteam: false,
      extra1HasSteam: false,
      extra2HasSteam: false,
      extra3HasSteam: false,
    });

    const count = await countUnlinkedSteamMembers(testApp.db, {
      visibility: 'private',
      createdBy: creator.id,
      inviteeUserIds: [invitee1.id, invitee2.id],
    });

    expect(count).toBe(2);
  });

  // ── Case 3: Private, no invitees, creator HAS steam ──────────

  it('private audience returns 0 when creator has steam and no invitees are present', async () => {
    const { creator } = await seedSixUserFixture({
      creatorHasSteam: true,
      invitee1HasSteam: false,
      invitee2HasSteam: false,
      extra1HasSteam: false,
      extra2HasSteam: false,
      extra3HasSteam: false,
    });

    const count = await countUnlinkedSteamMembers(testApp.db, {
      visibility: 'private',
      createdBy: creator.id,
      inviteeUserIds: [],
    });

    expect(count).toBe(0);
  });

  // ── Case 4: findUnlinkedSteamMembers parity ──────────────────

  it('findUnlinkedSteamMembers returns only the in-audience unlinked users for a private lineup', async () => {
    // Same fixture as case 2: creator + invitee2 unlinked, invitee1 linked,
    // 3 extras all unlinked but OUTSIDE the audience.
    const { creator, invitee1, invitee2, extra1, extra2, extra3 } =
      await seedSixUserFixture({
        creatorHasSteam: false,
        invitee1HasSteam: true,
        invitee2HasSteam: false,
        extra1HasSteam: false,
        extra2HasSteam: false,
        extra3HasSteam: false,
      });

    const members = await findUnlinkedSteamMembers(testApp.db, {
      visibility: 'private',
      createdBy: creator.id,
      inviteeUserIds: [invitee1.id, invitee2.id],
    });

    const returnedIds = members.map((m) => m.id).sort((a, b) => a - b);
    expect(returnedIds).toEqual([creator.id, invitee2.id].sort((a, b) => a - b));

    // The three outside-the-audience community users must not appear.
    expect(returnedIds).not.toContain(extra1.id);
    expect(returnedIds).not.toContain(extra2.id);
    expect(returnedIds).not.toContain(extra3.id);

    // Display-name field is populated (falls back to username if null).
    const creatorEntry = members.find((m) => m.id === creator.id);
    expect(creatorEntry?.displayName).toBe('Creator');
  });
}

describe('lineups-enrichment.helpers — audience scoping (ROK-1252)', () =>
  describeAudienceScopedEnrichment());
