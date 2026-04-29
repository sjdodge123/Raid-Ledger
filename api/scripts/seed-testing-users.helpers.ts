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

type Role = 'dps' | 'tank' | 'healer';
type CharSeed = {
  username: string;
  gameSlug: string;
  charName: string;
  class: string;
  spec: string;
  role: Role;
  wowClass: string;
};

// [username, gameSlug, charName, class, spec, role, wowClass]
type CharRow = [string, string, string, string, string, Role, string];

// prettier-ignore
const CHAR_ROWS: readonly CharRow[] = [
  // WoW Retail
  ['ShadowMage',     'world-of-warcraft', 'Shadowmage',   'Mage',         'Arcane',        'dps',    'mage'],
  ['DragonSlayer99', 'world-of-warcraft', 'Dragonslayer', 'Rogue',        'Assassination', 'dps',    'rogue'],
  ['HealzForDayz',   'world-of-warcraft', 'Healzfordays', 'Priest',       'Holy',          'healer', 'priest'],
  ['TankMaster',     'world-of-warcraft', 'Tankmaster',   'Warrior',      'Protection',    'tank',   'warrior'],
  ['ProRaider',      'world-of-warcraft', 'Deathbringer', 'Death Knight', 'Unholy',        'dps',    'deathknight'],
  ['NightOwlGamer',  'world-of-warcraft', 'Moonweaver',   'Druid',        'Restoration',   'healer', 'druid'],
  ['LootGoblin',     'world-of-warcraft', 'Felstrike',    'Warlock',      'Destruction',   'dps',    'warlock'],
  ['CasualCarl',     'world-of-warcraft', 'Shieldwall',   'Paladin',      'Protection',    'tank',   'paladin'],
  // WoW Classic
  ['ShadowMage',   'world-of-warcraft-classic', 'Frostbolt',    'Mage',    'Frost',      'dps',    'mage'],
  ['TankMaster',   'world-of-warcraft-classic', 'Ironfist',     'Warrior', 'Protection', 'tank',   'warrior'],
  ['HealzForDayz', 'world-of-warcraft-classic', 'Lightbringer', 'Priest',  'Holy',       'healer', 'priest'],
  ['ProRaider',    'world-of-warcraft-classic', 'Backstab',     'Rogue',   'Combat',     'dps',    'rogue'],
  // Valheim
  ['ShadowMage', 'valheim', 'Windwalker', 'Monk',   'Windwalker',   'dps',    'monk'],
  ['TankMaster', 'valheim', 'Earthguard', 'Shaman', 'Restoration',  'healer', 'shaman'],
  ['ProRaider',  'valheim', 'Hawkeye',    'Hunter', 'Marksmanship', 'dps',    'hunter'],
  // FFXIV
  ['NightOwlGamer', 'final-fantasy-xiv-online', 'Voidcaller', 'Evoker',       'Preservation', 'healer', 'evoker'],
  ['LootGoblin',    'final-fantasy-xiv-online', 'Demonbane',  'Demon Hunter', 'Havoc',        'dps',    'demonhunter'],
];

const charactersToCreate: CharSeed[] = CHAR_ROWS.map(
  ([username, gameSlug, charName, cls, spec, role, wowClass]) => ({
    username,
    gameSlug,
    charName,
    class: cls,
    spec,
    role,
    wowClass,
  }),
);

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
