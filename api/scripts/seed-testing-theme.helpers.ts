import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type User = typeof schema.users.$inferSelect;

const themeAssignments: Record<string, string> = {
  ShadowMage: 'default-dark',
  TankMaster: 'default-light',
  HealzForDayz: 'auto',
  DragonSlayer99: 'default-light',
  CasualCarl: 'default-dark',
  NightOwlGamer: 'auto',
  ProRaider: 'auto',
  LootGoblin: 'auto',
};

export async function seedThemePreferences(
  db: Db,
  createdUsers: User[],
): Promise<void> {
  console.log('\n🎨 Setting theme preferences...\n');

  for (const [username, theme] of Object.entries(themeAssignments)) {
    const user = createdUsers.find((u) => u.username === username);
    if (!user) continue;

    try {
      await db
        .insert(schema.userPreferences)
        .values({
          userId: user.id,
          key: 'theme',
          value: theme,
        })
        .onConflictDoNothing();
      console.log(`  🎨 ${username} → ${theme}`);
    } catch {
      console.log(`  ⏭️  Skipped theme for ${username} (may exist)`);
    }
  }

  const adminUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.role, 'admin'))
    .limit(1)
    .then((rows) => rows[0]);

  if (adminUser) {
    try {
      await db
        .insert(schema.userPreferences)
        .values({
          userId: adminUser.id,
          key: 'theme',
          value: 'auto',
        })
        .onConflictDoNothing();
      console.log(`  🎨 ${adminUser.username} (admin) → auto`);
    } catch {
      console.log(`  ⏭️  Skipped theme for admin (may exist)`);
    }
  }
}
