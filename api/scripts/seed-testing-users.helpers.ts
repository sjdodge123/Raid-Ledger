import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';
import { buildSeedProfessions } from './seed-testing.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type User = typeof schema.users.$inferSelect;

// Fake gamer data (ROK-194: Added Discord avatars for fallback testing)
export const FAKE_GAMERS = [
  { username: 'ShadowMage', avatar: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6' },
  { username: 'DragonSlayer99', avatar: 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7' },
  { username: 'HealzForDayz', avatar: 'c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8' },
  { username: 'TankMaster', avatar: 'd4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9' },
  { username: 'NightOwlGamer', avatar: 'e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0' },
  { username: 'CasualCarl', avatar: 'f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1' },
  { username: 'ProRaider', avatar: 'g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2' },
  { username: 'LootGoblin', avatar: 'h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3' },
];

/**
 * Get the Blizzard CDN URL for a WoW class icon.
 * Uses the official render CDN which hosts class icons at 56x56.
 */
export function getClassIconUrl(wowClass: string): string {
  return `https://render.worldofwarcraft.com/icons/56/classicon_${wowClass.toLowerCase()}.jpg`;
}

export async function seedUsers(db: Db): Promise<User[]> {
  console.log('👥 Creating fake gamers...\n');

  const createdUsers: User[] = [];

  for (const gamer of FAKE_GAMERS) {
    let user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, gamer.username))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      const [newUser] = await db
        .insert(schema.users)
        .values({
          username: gamer.username,
          avatar: gamer.avatar,
          role: 'member',
        })
        .returning();
      user = newUser;
      console.log(`  ✅ Created user: ${gamer.username}`);
    } else {
      console.log(`  ⏭️  Skipped: ${gamer.username} (exists)`);
    }

    createdUsers.push(user);
  }

  return createdUsers;
}

const charactersToCreate = [
  // WoW Retail characters
  {
    username: 'ShadowMage',
    gameSlug: 'world-of-warcraft',
    charName: 'Shadowmage',
    class: 'Mage',
    spec: 'Arcane',
    role: 'dps' as const,
    wowClass: 'mage',
  },
  {
    username: 'DragonSlayer99',
    gameSlug: 'world-of-warcraft',
    charName: 'Dragonslayer',
    class: 'Rogue',
    spec: 'Assassination',
    role: 'dps' as const,
    wowClass: 'rogue',
  },
  {
    username: 'HealzForDayz',
    gameSlug: 'world-of-warcraft',
    charName: 'Healzfordays',
    class: 'Priest',
    spec: 'Holy',
    role: 'healer' as const,
    wowClass: 'priest',
  },
  {
    username: 'TankMaster',
    gameSlug: 'world-of-warcraft',
    charName: 'Tankmaster',
    class: 'Warrior',
    spec: 'Protection',
    role: 'tank' as const,
    wowClass: 'warrior',
  },
  {
    username: 'ProRaider',
    gameSlug: 'world-of-warcraft',
    charName: 'Deathbringer',
    class: 'Death Knight',
    spec: 'Unholy',
    role: 'dps' as const,
    wowClass: 'deathknight',
  },
  {
    username: 'NightOwlGamer',
    gameSlug: 'world-of-warcraft',
    charName: 'Moonweaver',
    class: 'Druid',
    spec: 'Restoration',
    role: 'healer' as const,
    wowClass: 'druid',
  },
  {
    username: 'LootGoblin',
    gameSlug: 'world-of-warcraft',
    charName: 'Felstrike',
    class: 'Warlock',
    spec: 'Destruction',
    role: 'dps' as const,
    wowClass: 'warlock',
  },
  {
    username: 'CasualCarl',
    gameSlug: 'world-of-warcraft',
    charName: 'Shieldwall',
    class: 'Paladin',
    spec: 'Protection',
    role: 'tank' as const,
    wowClass: 'paladin',
  },
  // WoW Classic characters
  {
    username: 'ShadowMage',
    gameSlug: 'world-of-warcraft-classic',
    charName: 'Frostbolt',
    class: 'Mage',
    spec: 'Frost',
    role: 'dps' as const,
    wowClass: 'mage',
  },
  {
    username: 'TankMaster',
    gameSlug: 'world-of-warcraft-classic',
    charName: 'Ironfist',
    class: 'Warrior',
    spec: 'Protection',
    role: 'tank' as const,
    wowClass: 'warrior',
  },
  {
    username: 'HealzForDayz',
    gameSlug: 'world-of-warcraft-classic',
    charName: 'Lightbringer',
    class: 'Priest',
    spec: 'Holy',
    role: 'healer' as const,
    wowClass: 'priest',
  },
  {
    username: 'ProRaider',
    gameSlug: 'world-of-warcraft-classic',
    charName: 'Backstab',
    class: 'Rogue',
    spec: 'Combat',
    role: 'dps' as const,
    wowClass: 'rogue',
  },
  // Valheim characters
  {
    username: 'ShadowMage',
    gameSlug: 'valheim',
    charName: 'Windwalker',
    class: 'Monk',
    spec: 'Windwalker',
    role: 'dps' as const,
    wowClass: 'monk',
  },
  {
    username: 'TankMaster',
    gameSlug: 'valheim',
    charName: 'Earthguard',
    class: 'Shaman',
    spec: 'Restoration',
    role: 'healer' as const,
    wowClass: 'shaman',
  },
  {
    username: 'ProRaider',
    gameSlug: 'valheim',
    charName: 'Hawkeye',
    class: 'Hunter',
    spec: 'Marksmanship',
    role: 'dps' as const,
    wowClass: 'hunter',
  },
  // FFXIV characters
  {
    username: 'NightOwlGamer',
    gameSlug: 'final-fantasy-xiv-online',
    charName: 'Voidcaller',
    class: 'Evoker',
    spec: 'Preservation',
    role: 'healer' as const,
    wowClass: 'evoker',
  },
  {
    username: 'LootGoblin',
    gameSlug: 'final-fantasy-xiv-online',
    charName: 'Demonbane',
    class: 'Demon Hunter',
    spec: 'Havoc',
    role: 'dps' as const,
    wowClass: 'demonhunter',
  },
];

export async function seedCharacters(
  db: Db,
  createdUsers: User[],
): Promise<void> {
  console.log('\n🎭 Creating characters with WoW class icons...\n');

  const registryGames = await db.select().from(schema.games);

  if (registryGames.length === 0) {
    console.log('  ⚠️  No games found - skipping character creation');
    return;
  }

  const gameBySlug: Record<string, (typeof registryGames)[number]> = {};
  for (const g of registryGames) gameBySlug[g.slug] = g;

  // Track which users already have a main — only first character per player is main
  const usersWithMain = new Set<string>();

  for (const charData of charactersToCreate) {
    const user = createdUsers.find((u) => u.username === charData.username);
    const game = gameBySlug[charData.gameSlug];

    if (!user || !game) continue;

    const existing = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.userId, user.id))
      .then((rows) => rows.find((c) => c.gameId === game.id));

    if (!existing) {
      const isMain = !usersWithMain.has(charData.username);
      usersWithMain.add(charData.username);

      await db.insert(schema.characters).values({
        userId: user.id,
        gameId: game.id,
        name: charData.charName,
        class: charData.class,
        spec: charData.spec,
        role: charData.role,
        isMain,
        avatarUrl: getClassIconUrl(charData.wowClass),
        displayOrder: isMain ? 0 : 1,
        professions: buildSeedProfessions(charData.class, charData.gameSlug),
      });
      const tag = isMain ? 'MAIN' : 'ALT';
      console.log(
        `  ✅ Created ${charData.charName} [${charData.class}/${charData.spec}] (${game.name}) [${tag}]`,
      );
    } else {
      console.log(`  ⏭️  Skipped: ${charData.charName} (exists)`);
    }
  }
}
