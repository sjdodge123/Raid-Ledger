/**
 * ROK-2364 — core user delete / deactivate / reactivate / character delete
 * reach wow-common's GUID-release audits through the USER_LIFECYCLE registry,
 * and they run even while `blizzard` (wow-common) is INACTIVE: cleanup of data
 * a user withdrew runs regardless of plugin state.
 *
 * Seed: roster row R (GUID G + Blizzard id X). A's character holds G and wins
 * R; B's Armory character (external_id X) is suppressed until A lets go, and
 * then must get a fresh `external_id_linked` (via `guid_released`) so no member
 * grant made for A carries over to B (ROK-2115 / ROK-2160).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { CharactersService } from '../../../characters/characters.service';
import { DiscordNotificationService } from '../../../notifications/discord-notification.service';
import { UsersService } from '../../../users/users.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const PLUGIN = 'blizzard';
const FOREVER_SLUG = 'world-of-warcraft-forever';
const DAY = 86_400_000;
const NOW = Date.now();
const T0 = new Date(NOW - 8 * DAY); // characters created
const T1 = new Date(NOW - 6 * DAY); // A deactivated (backdated)
const T2 = new Date(NOW - 4 * DAY); // staff grant inside A's away window
const SNAP = new Date(NOW - DAY);

let testApp: TestApp;
let registry: PluginRegistryService;
let gameId: number;
let seq = 0;
const next = (): number => {
  seq += 1;
  return seq;
};

async function ensureGame(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertUser(): Promise<number> {
  const n = next();
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:lifecycle-2364-${n}@test`,
        username: `Lifecycle2364_${n}`,
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

async function insertChar(
  userId: number,
  o: { externalId?: string; addonGuid?: string },
): Promise<string> {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId,
        name: `LifecycleChar${next()}`,
        role: 'dps',
        isMain: false,
        region: 'us',
        externalId: o.externalId ?? null,
        addonGuid: o.addonGuid ?? null,
        createdAt: T0,
      })
      .returning({ id: schema.characters.id }),
    'character',
  );
  return c.id;
}

async function seed() {
  const name = `Lifecycle 2364 ${next()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  const blizzardId = 930_000_000 + next();
  const guid = `Player-2364-${next()}`;
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId: g.id,
        guid,
        blizzardCharacterId: blizzardId,
        characterName: `LifecycleRow${next()}`,
        rankIndex: 3,
        rankName: 'Member',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning({ id: schema.guildMembers.id }),
    'member row',
  );
  const ownerA = await insertUser();
  const charA = await insertChar(ownerA, { addonGuid: guid });
  const ownerB = await insertUser();
  const charB = await insertChar(ownerB, { externalId: String(blizzardId) });
  return { guildId: g.id, memberId: m.id, ownerA, charA, ownerB, charB };
}

type Seed = Awaited<ReturnType<typeof seed>>;

async function linkAudits(ownerId: number) {
  const rows = await testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'addon_guid'),
        inArray(schema.activityLog.action, [
          'addon_guid_claimed',
          'external_id_linked',
        ]),
        eq(schema.activityLog.entityId, ownerId),
      ),
    );
  return rows.map((a) => [a.action, a.metadata]);
}

/** B, the row's new Blizzard-id winner, got exactly one fresh link audit. */
async function expectBReleaseAudit(s: Seed): Promise<void> {
  expect(await linkAudits(s.ownerB)).toEqual([
    [
      'external_id_linked',
      expect.objectContaining({ characterId: s.charB, via: 'guid_released' }),
    ],
  ]);
}

const deactivate = (userId: number) =>
  testApp.app.get(DiscordNotificationService).deactivateUser(userId, 'manual');

beforeAll(async () => {
  testApp = await getTestApp();
  registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled(PLUGIN);
  gameId = await ensureGame();
});

// Leave the plugin as the other specs expect it. No truncate here: the shared
// integration setup closes the pool, and the next spec truncates in beforeAll.
afterAll(async () => {
  await registry.activate(PLUGIN);
});

describe('ROK-2364: lifecycle cleanup runs while the owning plugin is INACTIVE', () => {
  beforeAll(async () => {
    await registry.activate(PLUGIN);
    await registry.deactivate(PLUGIN);
    expect(registry.isActive(PLUGIN)).toBe(false);
  });

  it('a. user delete: the wiped GUID holder row gets a release audit for B', async () => {
    const s = await seed();
    await testApp.app
      .get(UsersService)
      .deleteUser(s.ownerA, testApp.seed.adminUser.id);
    await expectBReleaseAudit(s);
  });

  it('b. deactivation: B gets a release audit', async () => {
    const s = await seed();
    await deactivate(s.ownerA);
    await expectBReleaseAudit(s);
  });

  it('c. reactivation after a staff grant meanwhile: A gets owner_reactivated', async () => {
    const s = await seed();
    await deactivate(s.ownerA);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: T1 })
      .where(eq(schema.users.id, s.ownerA));
    await testApp.db.insert(schema.guildEditors).values({
      guildId: s.guildId,
      kind: 'member',
      guildMemberId: s.memberId,
      createdAt: T2,
    });
    await testApp.app.get(UsersService).reactivateUser(s.ownerA);
    expect(await linkAudits(s.ownerA)).toEqual([
      [
        'addon_guid_claimed',
        expect.objectContaining({
          characterId: s.charA,
          via: 'owner_reactivated',
        }),
      ],
    ]);
  });

  it('d. character delete: B gets exactly one release audit', async () => {
    const s = await seed();
    await testApp.app.get(CharactersService).delete(s.ownerA, s.charA);
    await expectBReleaseAudit(s);
  });
});

describe('ROK-2364 parity: the same cleanup while the plugin is active', () => {
  beforeAll(async () => {
    await registry.activate(PLUGIN);
    expect(registry.isActive(PLUGIN)).toBe(true);
  });

  it('e. deactivation: B gets a release audit', async () => {
    const s = await seed();
    await deactivate(s.ownerA);
    await expectBReleaseAudit(s);
  });
});
