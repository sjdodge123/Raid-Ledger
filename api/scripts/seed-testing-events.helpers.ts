import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type User = typeof schema.users.$inferSelect;

export async function seedEventSignups(
  db: Db,
  createdUsers: User[],
): Promise<void> {
  console.log('\n📝 Creating event signups with character links...\n');

  const allEvents = await db.select().from(schema.events);
  // Pre-fetch all characters for our seed users
  const allCharacters = await db.select().from(schema.characters);

  for (const event of allEvents) {
    // Sign up 3-5 random users for each event
    const numSignups = Math.floor(Math.random() * 3) + 3;
    const shuffledUsers = [...createdUsers].sort(() => Math.random() - 0.5);
    const selectedUsers = shuffledUsers.slice(0, numSignups);

    for (const user of selectedUsers) {
      const existingSignup = await db
        .select()
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.eventId, event.id))
        .then((rows) => rows.find((r) => r.userId === user.id));

      if (!existingSignup) {
        // Find user's character for this event's game
        const userChar = event.gameId
          ? allCharacters.find(
              (c) => c.userId === user.id && c.gameId === event.gameId,
            )
          : undefined;

        await db.insert(schema.eventSignups).values({
          eventId: event.id,
          userId: user.id,
          characterId: userChar?.id ?? null,
          confirmationStatus: userChar ? 'confirmed' : 'pending',
        });
        const charInfo = userChar ? ` [${userChar.name}]` : '';
        console.log(`  ✅ ${user.username}${charInfo} → ${event.title}`);
      }
    }
  }
}
