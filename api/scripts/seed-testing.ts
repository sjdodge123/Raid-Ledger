import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule, DrizzleAsyncProvider } from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Seed data for testing users, signups, and availability.
 * Creates fake gamers with event signups and some unavailable periods.
 */

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        DrizzleModule,
    ],
})
class SeedTestingModule { }

// Fake gamer data (ROK-194: Added Discord avatars for fallback testing)
const FAKE_GAMERS = [
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
function getClassIconUrl(wowClass: string): string {
    return `https://render.worldofwarcraft.com/icons/56/classicon_${wowClass.toLowerCase()}.jpg`;
}

async function bootstrap() {
    console.log('🌱 Seeding test users, signups, and availability...\n');

    const app = await NestFactory.createApplicationContext(SeedTestingModule);
    const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

    try {
        // =====================
        // Create Fake Users
        // =====================
        console.log('👥 Creating fake gamers...\n');

        const createdUsers: (typeof schema.users.$inferSelect)[] = [];

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
                        isAdmin: false,
                    })
                    .returning();
                user = newUser;
                console.log(`  ✅ Created user: ${gamer.username}`);
            } else {
                console.log(`  ⏭️  Skipped: ${gamer.username} (exists)`);
            }

            createdUsers.push(user);
        }

        // =====================
        // Create Characters with WoW Class Icons (ROK-194)
        // =====================
        console.log('\n🎭 Creating characters with WoW class icons...\n');

        // Get some games from game registry for character creation
        const registryGames = await db.select().from(schema.gameRegistry).limit(3);

        if (registryGames.length > 0) {
            // Characters with WoW class/role assignments and Blizzard CDN class icons
            const charactersToCreate = [
                { username: 'ShadowMage', gameIdx: 0, charName: 'Shadowmage', class: 'Mage', spec: 'Arcane', role: 'dps' as const, wowClass: 'mage' },
                { username: 'DragonSlayer99', gameIdx: 0, charName: 'Dragonslayer', class: 'Rogue', spec: 'Assassination', role: 'dps' as const, wowClass: 'rogue' },
                { username: 'HealzForDayz', gameIdx: 0, charName: 'Healzfordays', class: 'Priest', spec: 'Holy', role: 'healer' as const, wowClass: 'priest' },
                { username: 'TankMaster', gameIdx: 0, charName: 'Tankmaster', class: 'Warrior', spec: 'Protection', role: 'tank' as const, wowClass: 'warrior' },
                { username: 'ProRaider', gameIdx: 0, charName: 'Deathbringer', class: 'Death Knight', spec: 'Unholy', role: 'dps' as const, wowClass: 'deathknight' },
                { username: 'NightOwlGamer', gameIdx: 0, charName: 'Moonweaver', class: 'Druid', spec: 'Restoration', role: 'healer' as const, wowClass: 'druid' },
                { username: 'LootGoblin', gameIdx: 0, charName: 'Felstrike', class: 'Warlock', spec: 'Destruction', role: 'dps' as const, wowClass: 'warlock' },
                { username: 'CasualCarl', gameIdx: 0, charName: 'Shieldwall', class: 'Paladin', spec: 'Protection', role: 'tank' as const, wowClass: 'paladin' },
                // Second game characters (alts)
                { username: 'ShadowMage', gameIdx: 1, charName: 'Windwalker', class: 'Monk', spec: 'Windwalker', role: 'dps' as const, wowClass: 'monk' },
                { username: 'TankMaster', gameIdx: 1, charName: 'Earthguard', class: 'Shaman', spec: 'Restoration', role: 'healer' as const, wowClass: 'shaman' },
                { username: 'ProRaider', gameIdx: 1, charName: 'Hawkeye', class: 'Hunter', spec: 'Marksmanship', role: 'dps' as const, wowClass: 'hunter' },
                // Third game characters (alts)
                { username: 'NightOwlGamer', gameIdx: 2, charName: 'Voidcaller', class: 'Evoker', spec: 'Preservation', role: 'healer' as const, wowClass: 'evoker' },
                { username: 'LootGoblin', gameIdx: 2, charName: 'Demonbane', class: 'Demon Hunter', spec: 'Havoc', role: 'dps' as const, wowClass: 'demonhunter' },
            ];

            // Track which users already have a main — only first character per player is main
            const usersWithMain = new Set<string>();

            for (const charData of charactersToCreate) {
                const user = createdUsers.find((u) => u.username === charData.username);
                const game = registryGames[charData.gameIdx];

                if (!user || !game) continue;

                // Check if character already exists
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
                    });
                    const tag = isMain ? 'MAIN' : 'ALT';
                    console.log(`  ✅ Created ${charData.charName} [${charData.class}/${charData.spec}] (${game.name}) [${tag}]`);
                } else {
                    console.log(`  ⏭️  Skipped: ${charData.charName} (exists)`);
                }
            }
        } else {
            console.log('  ⚠️  No games found - skipping character creation');
        }

        // =====================
        // Create Event Signups (linked to characters)
        // =====================
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
                // Check if signup exists
                const existingSignup = await db
                    .select()
                    .from(schema.eventSignups)
                    .where(eq(schema.eventSignups.eventId, event.id))
                    .then((rows) => rows.find((r) => r.userId === user.id));

                if (!existingSignup) {
                    // Find user's character for this event's game
                    const userChar = event.registryGameId
                        ? allCharacters.find(
                            (c) => c.userId === user.id && c.gameId === event.registryGameId,
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

        // =====================
        // Create Unavailability
        // =====================
        console.log('\n⏰ Creating unavailability periods...\n');

        const now = new Date();
        const roundToHour = (date: Date): Date => {
            const rounded = new Date(date);
            rounded.setMinutes(0, 0, 0);
            return rounded;
        };
        const baseHour = roundToHour(now);

        // Helper functions
        const hoursFromNow = (hours: number) => new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
        const daysFromNow = (days: number) => new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

        // Define availability/unavailability for heatmap testing
        // Need to overlap with event times for visibility
        const availabilityData = [
            // Available slots (will show green on heatmap)
            { username: 'ShadowMage', start: hoursFromNow(-2), end: hoursFromNow(4), status: 'available' as const },
            { username: 'DragonSlayer99', start: hoursFromNow(-1), end: hoursFromNow(6), status: 'available' as const },
            { username: 'HealzForDayz', start: hoursFromNow(0), end: hoursFromNow(3), status: 'available' as const },
            { username: 'TankMaster', start: hoursFromNow(-3), end: hoursFromNow(5), status: 'available' as const },
            { username: 'ProRaider', start: hoursFromNow(1), end: hoursFromNow(8), status: 'available' as const },

            // Blocked slots (will show gray/locked on heatmap)
            { username: 'HealzForDayz', start: hoursFromNow(3), end: hoursFromNow(6), status: 'blocked' as const },
            { username: 'CasualCarl', start: hoursFromNow(-1), end: hoursFromNow(2), status: 'blocked' as const },
            { username: 'NightOwlGamer', start: hoursFromNow(0), end: hoursFromNow(4), status: 'blocked' as const },

            // Future unavailability 
            { username: 'DragonSlayer99', start: daysFromNow(2), end: daysFromNow(4), status: 'blocked' as const },
            { username: 'TankMaster', start: daysFromNow(5), end: daysFromNow(7), status: 'blocked' as const },
        ];

        for (const avail of availabilityData) {
            const user = createdUsers.find((u) => u.username === avail.username);
            if (!user) continue;

            // Create availability record
            try {
                await db.insert(schema.availability).values({
                    userId: user.id,
                    timeRange: [avail.start, avail.end],
                    status: avail.status,
                });
                const icon = avail.status === 'available' ? '✅' : '❌';
                console.log(`  ${icon} ${user.username}: ${avail.status} (${avail.start.toLocaleTimeString()} - ${avail.end.toLocaleTimeString()})`);
            } catch {
                console.log(`  ⏭️  Skipped availability for ${user.username} (may exist)`);
            }
        }

        console.log('\n🎉 Testing data seed complete!');
        console.log('\n📍 View events at: http://localhost:80/events');
        console.log('📍 View calendar at: http://localhost:80/calendar');
    } catch (err) {
        console.error('❌ Seeding failed:', err);
        await app.close();
        process.exit(1);
    }

    await app.close();
    process.exit(0);
}

bootstrap();
