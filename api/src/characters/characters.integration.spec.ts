/**
 * Characters & User Management Integration Tests (ROK-525)
 *
 * Verifies character CRUD (auto-main, duplicate-claim, atomic swap,
 * auto-promote on delete) and user management (cascading delete,
 * Discord link/unlink, display name availability) against a real
 * PostgreSQL database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

/** Helper to create a member user with local credentials and return their token. */
async function createMemberAndLogin(
  testApp: TestApp,
  username: string,
  email: string,
): Promise<{ userId: number; token: string }> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);

  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${email}`,
      username,
      role: 'member',
    })
    .returning();

  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash,
    userId: user.id,
  });

  const loginRes = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });

  return { userId: user.id, token: loginRes.body.access_token as string };
}

function describeCharactersUserManagement() {
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

  // ===================================================================
  // Character CRUD
  // ===================================================================

  function describeCharacterCreate() {
    it('should auto-main the first character for a game', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'charuser1',
        'charuser1@test.local',
      );

      const res = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'FirstChar',
          class: 'Warrior',
          role: 'tank',
        });

      expect(res.status).toBe(201);
      expect(res.body.isMain).toBe(true);
      expect(res.body.name).toBe('FirstChar');
    });

    async function testDemoteExistingMainWhenCreatingANewMain() {
      const { token } = await createMemberAndLogin(
        testApp,
        'charuser2',
        'charuser2@test.local',
      );

      // Create first character (auto-main)
      const first = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'OldMain',
          class: 'Mage',
          role: 'dps',
        });

      expect(first.body.isMain).toBe(true);

      // Create second character marked as main
      const second = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'NewMain',
          realm: 'OtherRealm',
          class: 'Priest',
          role: 'healer',
          isMain: true,
        });

      expect(second.status).toBe(201);
      expect(second.body.isMain).toBe(true);

      // Verify old main was demoted
      const listRes = await testApp.request
        .get('/users/me/characters')
        .set('Authorization', `Bearer ${token}`);

      const chars = (
        listRes.body as { data: Array<{ name: string; isMain: boolean }> }
      ).data;
      const oldMain = chars.find((c) => c.name === 'OldMain');
      expect(oldMain?.isMain).toBe(false);
    }
    it('should demote existing main when creating a new main', () =>
      testDemoteExistingMainWhenCreatingANewMain());

    async function testBlockDuplicateClaimForSameRealmNameByDifferentUser() {
      const { token: t1 } = await createMemberAndLogin(
        testApp,
        'owner',
        'owner@test.local',
      );
      const { token: t2 } = await createMemberAndLogin(
        testApp,
        'thief',
        'thief@test.local',
      );

      // First user creates a character with a realm
      await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${t1}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'UniqueChar',
          realm: 'Stormrage',
          class: 'Rogue',
          role: 'dps',
        });

      // Second user tries to claim the same name+realm
      const dupRes = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${t2}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'UniqueChar',
          realm: 'Stormrage',
          class: 'Rogue',
          role: 'dps',
        });

      expect(dupRes.status).toBe(409);
    }
    it('should block duplicate-claim for same realm+name by different user', () =>
      testBlockDuplicateClaimForSameRealmNameByDifferentUser());

    it('should allow same name without realm (non-MMO games)', async () => {
      const { token: t1 } = await createMemberAndLogin(
        testApp,
        'norealm1',
        'norealm1@test.local',
      );
      const { token: t2 } = await createMemberAndLogin(
        testApp,
        'norealm2',
        'norealm2@test.local',
      );

      // Both users create characters with the same name but no realm
      const r1 = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${t1}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'GenericName',
          class: 'Fighter',
        });

      const r2 = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${t2}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'GenericName',
          class: 'Fighter',
        });

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
    });
  }
  describe('character create', () => describeCharacterCreate());

  // ===================================================================
  // Character Delete with Auto-Promote
  // ===================================================================

  function describeCharacterDelete() {
    async function testAutoPromoteNextAltToMainWhenMainIsDeleted() {
      const { token } = await createMemberAndLogin(
        testApp,
        'deluser',
        'deluser@test.local',
      );

      // Create two characters — first is auto-main
      const main = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'MainChar',
          class: 'Warrior',
          role: 'tank',
        });

      await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'AltChar',
          realm: 'AltRealm',
          class: 'Mage',
          role: 'dps',
        });

      // Delete main
      const delRes = await testApp.request
        .delete(`/users/me/characters/${main.body.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(delRes.status).toBe(200);

      // Alt should be promoted to main
      const listRes = await testApp.request
        .get('/users/me/characters')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].name).toBe('AltChar');
      expect(listRes.body.data[0].isMain).toBe(true);
    }
    it('should auto-promote next alt to main when main is deleted', () =>
      testAutoPromoteNextAltToMainWhenMainIsDeleted());
  }
  describe('character delete', () => describeCharacterDelete());

  // ===================================================================
  // Character Set Main (Atomic Swap)
  // ===================================================================

  function describeCharacterSetMain() {
    async function testAtomicallySwapMainDesignation() {
      const { token } = await createMemberAndLogin(
        testApp,
        'swapuser',
        'swapuser@test.local',
      );

      // Create two characters
      const char1 = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'OriginalMain',
          class: 'Warrior',
          role: 'tank',
        });

      const char2 = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'PromotedAlt',
          realm: 'AltRealm',
          class: 'Mage',
          role: 'dps',
        });

      expect(char1.body.isMain).toBe(true);
      expect(char2.body.isMain).toBe(false);

      // Set char2 as main
      const setMainRes = await testApp.request
        .patch(`/users/me/characters/${char2.body.id}/set-main`)
        .set('Authorization', `Bearer ${token}`);

      expect(setMainRes.status).toBe(200);
      expect(setMainRes.body.isMain).toBe(true);

      // Verify char1 is no longer main
      const listRes = await testApp.request
        .get('/users/me/characters')
        .set('Authorization', `Bearer ${token}`);

      const chars = (
        listRes.body as { data: Array<{ id: string; isMain: boolean }> }
      ).data;
      const c1Id = (char1.body as { id: string }).id;
      const c2Id = (char2.body as { id: string }).id;
      const oldMain = chars.find((c) => c.id === c1Id);
      const newMain = chars.find((c) => c.id === c2Id);
      expect(oldMain?.isMain).toBe(false);
      expect(newMain?.isMain).toBe(true);
    }
    it('should atomically swap main designation', () =>
      testAtomicallySwapMainDesignation());
  }
  describe('character setMain', () => describeCharacterSetMain());

  // ===================================================================
  // Character Update
  // ===================================================================

  describe('character update', () => {
    it('should update character fields and persist', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'updateuser',
        'updateuser@test.local',
      );

      const char = await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'Updatable',
          class: 'Warrior',
          role: 'tank',
        });

      const updateRes = await testApp.request
        .patch(`/users/me/characters/${char.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ spec: 'Protection', itemLevel: 450 });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.spec).toBe('Protection');
      expect(updateRes.body.itemLevel).toBe(450);

      // Verify persistence
      const getRes = await testApp.request
        .get(`/users/me/characters/${char.body.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.body.spec).toBe('Protection');
      expect(getRes.body.itemLevel).toBe(450);
    });
  });

  // ===================================================================
  // User Delete (Cascading)
  // ===================================================================

  function describeUserDelete() {
    async function testCascadeDeleteCharactersAndSignupsWhenAdminRemovesUse() {
      const { userId, token } = await createMemberAndLogin(
        testApp,
        'deletable',
        'deletable@test.local',
      );

      // Create a character for the user
      await testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameId: testApp.seed.game.id,
          name: 'DomedChar',
          class: 'Mage',
          role: 'dps',
        });

      // Create an event and sign up the user
      const eventRes = await testApp.request
        .post('/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Cascade Test Event',
          startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString(),
        });

      await testApp.request
        .post(`/events/${eventRes.body.id}/signup`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Admin deletes the user
      const deleteRes = await testApp.request
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(204);

      // Verify user no longer exists
      const [deletedUser] = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      expect(deletedUser).toBeUndefined();

      // Verify characters were cascaded
      const chars = await testApp.db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.userId, userId));

      expect(chars.length).toBe(0);

      // Verify signups were cascaded
      const signups = await testApp.db
        .select()
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.userId, userId));

      expect(signups.length).toBe(0);
    }
    it('should cascade delete characters and signups when admin removes user', () =>
      testCascadeDeleteCharactersAndSignupsWhenAdminRemovesUse());

    async function testReassignEventsToAdminWhenUserIsDeleted() {
      const { userId } = await createMemberAndLogin(
        testApp,
        'eventcreator',
        'eventcreator@test.local',
      );

      // Have the member create an event (need operator role first)
      await testApp.db
        .update(schema.users)
        .set({ role: 'operator' })
        .where(eq(schema.users.id, userId));

      // Re-login to get updated token
      const reloginRes = await testApp.request.post('/auth/local').send({
        email: 'eventcreator@test.local',
        password: 'TestPassword123!',
      });
      const updatedToken = reloginRes.body.access_token as string;

      const eventRes = await testApp.request
        .post('/events')
        .set('Authorization', `Bearer ${updatedToken}`)
        .send({
          title: 'Orphaned Event',
          startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString(),
        });

      const eventId = eventRes.body.id;

      // Admin deletes the user
      await testApp.request
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Verify event was reassigned to admin
      const [event] = await testApp.db
        .select({ creatorId: schema.events.creatorId })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      expect(event.creatorId).toBe(testApp.seed.adminUser.id);
    }
    it('should reassign events to admin when user is deleted', () =>
      testReassignEventsToAdminWhenUserIsDeleted());
  }
  describe('user delete', () => describeUserDelete());

  // ===================================================================
  // Discord Link/Unlink
  // ===================================================================

  function describeDiscordLinkUnlink() {
    it('should unlink discord and prefix with unlinked:', async () => {
      // Create a user with a real discord ID (not local:)
      const [user] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: '123456789',
          username: 'discorduser',
          role: 'member',
        })
        .returning();

      // Create local credentials for login
      const passwordHash = await bcrypt.hash('TestPassword123!', 4);
      await testApp.db.insert(schema.localCredentials).values({
        email: 'discord@test.local',
        passwordHash,
        userId: user.id,
      });

      const loginRes = await testApp.request
        .post('/auth/local')
        .send({ email: 'discord@test.local', password: 'TestPassword123!' });
      const token = loginRes.body.access_token as string;

      // Unlink discord
      const unlinkRes = await testApp.request
        .delete('/users/me/discord')
        .set('Authorization', `Bearer ${token}`);

      expect(unlinkRes.status).toBe(204);

      // Verify discordId now has unlinked: prefix
      const [updated] = await testApp.db
        .select({ discordId: schema.users.discordId })
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .limit(1);

      expect(updated.discordId).toBe('unlinked:123456789');
    });
  }
  describe('discord link/unlink', () => describeDiscordLinkUnlink());

  // ===================================================================
  // Display Name
  // ===================================================================

  function describeDisplayName() {
    it('should update display name with availability check', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'nameuser',
        'nameuser@test.local',
      );

      const updateRes = await testApp.request
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'CoolDisplayName' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.displayName).toBe('CoolDisplayName');
    });

    it('should reject duplicate display name (case-insensitive)', async () => {
      const { token: t1 } = await createMemberAndLogin(
        testApp,
        'first',
        'first@test.local',
      );
      const { token: t2 } = await createMemberAndLogin(
        testApp,
        'second',
        'second@test.local',
      );

      // First user sets display name
      await testApp.request
        .patch('/users/me')
        .set('Authorization', `Bearer ${t1}`)
        .send({ displayName: 'TakenName' });

      // Second user tries the same name (different case)
      const dupRes = await testApp.request
        .patch('/users/me')
        .set('Authorization', `Bearer ${t2}`)
        .send({ displayName: 'takenname' });

      expect(dupRes.status).toBe(400);
    });
  }
  describe('display name', () => describeDisplayName());

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require authentication for character endpoints', async () => {
      const res = await testApp.request.get('/users/me/characters');

      expect(res.status).toBe(401);
    });
  });
}
describe('Characters & User Management (integration)', () =>
  describeCharactersUserManagement());

// =====================================================================
// ROK-1130 — WoW profession sync persistence
//
// Verifies that BlizzardService.fetchCharacterProfessions feeds the
// orchestrator (AC #2), re-sync overwrites instead of appending (AC #10),
// and the architect-required 5xx-leaves-prior-value contract holds
// (architect §3 / brief mandatory correction #1 + #5). The test exercises
// the cron-style `syncAllCharacters` path directly so it does not need
// the `RequirePlugin('blizzard')` HTTP guard.
// =====================================================================

import { CharactersService } from './characters.service';
import { BlizzardService } from '../plugins/wow-common/blizzard.service';

interface ProfessionFixture {
  primary: Array<{
    id: number;
    name: string;
    slug: string;
    skillLevel: number;
    maxSkillLevel: number;
    tiers: Array<{
      id: number;
      name: string;
      skillLevel: number;
      maxSkillLevel: number;
    }>;
  }>;
  secondary: Array<{
    id: number;
    name: string;
    slug: string;
    skillLevel: number;
    maxSkillLevel: number;
    tiers: unknown[];
  }>;
  syncedAt: string;
}

function buildFixture(
  primaryName: string,
  primarySkill: number,
): ProfessionFixture {
  return {
    primary: [
      {
        id: 197,
        name: primaryName,
        slug: primaryName.toLowerCase().replace(/\s+/g, '-'),
        skillLevel: primarySkill,
        maxSkillLevel: 450,
        tiers: [
          {
            id: 2823,
            name: 'Dragon Isles Tailoring',
            skillLevel: 100,
            maxSkillLevel: 100,
          },
        ],
      },
    ],
    secondary: [
      {
        id: 185,
        name: 'Cooking',
        slug: 'cooking',
        skillLevel: 150,
        maxSkillLevel: 150,
        tiers: [],
      },
    ],
    syncedAt: '2026-04-28T00:00:00.000Z',
  };
}

async function ensureWowGame(testApp: TestApp): Promise<number> {
  const existing = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, 'world-of-warcraft'))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [game] = await testApp.db
    .insert(schema.games)
    .values({
      name: 'World of Warcraft',
      slug: 'world-of-warcraft',
      coverUrl: null,
      igdbId: null,
    })
    .returning();
  return game.id;
}

async function insertSyncableCharacter(
  testApp: TestApp,
  userId: number,
  gameId: number,
  overrides: Partial<typeof schema.characters.$inferInsert> = {},
): Promise<typeof schema.characters.$inferSelect> {
  const [char] = await testApp.db
    .insert(schema.characters)
    .values({
      userId,
      gameId,
      name: 'Profsync',
      realm: 'area-52',
      class: 'Mage',
      spec: 'Frost',
      role: 'dps',
      isMain: true,
      region: 'us',
      gameVariant: 'retail',
      ...overrides,
    })
    .returning();
  return char;
}

function describeProfessionSync() {
  let testApp: TestApp;
  let blizzard: BlizzardService;
  let charactersService: CharactersService;
  let userId: number;
  let gameId: number;

  beforeAll(async () => {
    testApp = await getTestApp();
    blizzard = testApp.app.get(BlizzardService);
    charactersService = testApp.app.get(CharactersService);
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    gameId = await ensureWowGame(testApp);
    const created = await createMemberAndLogin(
      testApp,
      'profowner',
      'profowner@test.local',
    );
    userId = created.userId;
    // Stable returns for non-profession Blizzard calls so syncAllCharacters
    // doesn't error out before reaching fetchCharacterProfessions.
    jest.spyOn(blizzard, 'fetchCharacterProfile').mockResolvedValue({
      name: 'Profsync',
      realm: 'area-52',
      class: 'Mage',
      spec: 'Frost',
      role: 'dps',
      level: 80,
      race: 'Gnome',
      faction: 'alliance',
      itemLevel: 480,
      avatarUrl: null,
      renderUrl: null,
      profileUrl: null,
    });
    jest
      .spyOn(blizzard, 'fetchCharacterSpecializations')
      .mockResolvedValue({ spec: 'Frost', role: 'dps', talents: null });
    jest.spyOn(blizzard, 'fetchCharacterEquipment').mockResolvedValue({
      equippedItemLevel: 480,
      items: [],
      syncedAt: '2026-04-28T00:00:00.000Z',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists professions JSONB when service returns a fixture (AC #2)', async () => {
    const fixture = buildFixture('Tailoring', 450);
    jest
      .spyOn(blizzard, 'fetchCharacterProfessions')
      .mockResolvedValue(fixture);

    const char = await insertSyncableCharacter(testApp, userId, gameId);
    await charactersService.syncAllCharacters();

    const [reloaded] = await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, char.id))
      .limit(1);
    expect(reloaded.professions).toEqual(fixture);
  });

  it('overwrites prior professions on re-sync — no concat (AC #10)', async () => {
    const first = buildFixture('Tailoring', 200);
    const second = buildFixture('Enchanting', 425);
    const spy = jest
      .spyOn(blizzard, 'fetchCharacterProfessions')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const char = await insertSyncableCharacter(testApp, userId, gameId);
    await charactersService.syncAllCharacters();
    await charactersService.syncAllCharacters();

    const [reloaded] = await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, char.id))
      .limit(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(reloaded.professions).toEqual(second);
    // Defensive: not a concat / not duplicated
    const professions = reloaded.professions as ProfessionFixture | null;
    expect(professions?.primary).toHaveLength(1);
    expect(professions?.primary[0].name).toBe('Enchanting');
  });

  it('leaves prior professions untouched when service returns null (5xx — architect §3)', async () => {
    const prior = buildFixture('Mining', 300);

    // Pre-populate professions on the row.
    const char = await insertSyncableCharacter(testApp, userId, gameId, {
      professions: prior,
    });

    // Service returns null (signals 5xx / network failure).
    jest
      .spyOn(blizzard, 'fetchCharacterProfessions')
      .mockResolvedValue(null);

    await charactersService.syncAllCharacters();

    const [reloaded] = await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, char.id))
      .limit(1);
    expect(reloaded.professions).toEqual(prior);
  });

  it('persists empty arrays when service returns the 404-graceful payload (AC #2 edge case)', async () => {
    const empty = {
      primary: [],
      secondary: [],
      syncedAt: '2026-04-28T00:00:00.000Z',
    };
    jest
      .spyOn(blizzard, 'fetchCharacterProfessions')
      .mockResolvedValue(empty);

    const char = await insertSyncableCharacter(testApp, userId, gameId);
    await charactersService.syncAllCharacters();

    const [reloaded] = await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, char.id))
      .limit(1);
    expect(reloaded.professions).toEqual(empty);
  });
}

describe('Character profession sync (ROK-1130 integration)', () =>
  describeProfessionSync());

// AC #14 — seed-testing.ts populates professions on each WoW seed character.
//
// The Phase D1 dev brief mandates a `buildSeedProfessions(charClass, gameSlug)`
// helper inside seed-testing.ts (per-class profession map). To make that
// helper unit-testable without triggering the script's top-level `bootstrap()`,
// dev must extract it into a small importable module — e.g.
// `api/scripts/seed-testing.helpers.ts` — that seed-testing.ts then consumes.
// This test pins the contract; the import will fail until the helper module
// exists, which is the TDD signal.
describe('seed-testing buildSeedProfessions (ROK-1130, AC #14)', () => {
  it('produces a CharacterProfessions shape for retail WoW classes', async () => {
    const { buildSeedProfessions } = await import(
      '../../scripts/seed-testing.helpers'
    );
    const result = buildSeedProfessions('Mage', 'world-of-warcraft');
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.primary)).toBe(true);
    expect(result!.primary.length).toBeGreaterThan(0);
    expect(result!.primary[0].tiers.length).toBeGreaterThan(0);
    expect(typeof result!.syncedAt).toBe('string');
  });

  it('produces empty tiers for classic WoW characters', async () => {
    const { buildSeedProfessions } = await import(
      '../../scripts/seed-testing.helpers'
    );
    const result = buildSeedProfessions('Mage', 'world-of-warcraft-classic');
    expect(result).not.toBeNull();
    expect(result!.primary[0].tiers).toEqual([]);
  });

  it('returns null for non-WoW games', async () => {
    const { buildSeedProfessions } = await import(
      '../../scripts/seed-testing.helpers'
    );
    const result = buildSeedProfessions('Monk', 'valheim');
    expect(result).toBeNull();
  });
});
