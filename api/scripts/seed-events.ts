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
 * Seed data for sample events.
 * Creates events with various statuses (upcoming, live, ended) for visual testing.
 */

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        DrizzleModule,
    ],
})
class SeedEventsModule { }

async function bootstrap() {
    console.log('🌱 Seeding sample events...\n');

    const app = await NestFactory.createApplicationContext(SeedEventsModule);
    const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

    try {
        // Get or create a seed user
        let seedUser = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.username, 'SeedAdmin'))
            .limit(1)
            .then((rows) => rows[0]);

        if (!seedUser) {
            console.log('  Creating seed user...');
            const [newUser] = await db
                .insert(schema.users)
                .values({
                    username: 'SeedAdmin',
                    isAdmin: true,
                })
                .returning();
            seedUser = newUser;
            console.log('  ✅ Created seed user: SeedAdmin');
        } else {
            console.log('  ⏭️  Using existing user: SeedAdmin');
        }

        // Get games from registry
        const games = await db.select().from(schema.gameRegistry);
        const wowGame = games.find((g) => g.slug === 'wow');
        const valheimGame = games.find((g) => g.slug === 'valheim');
        const ffxivGame = games.find((g) => g.slug === 'ffxiv');

        if (!wowGame) {
            console.error('❌ No games found! Run seed-games.ts first.');
            process.exit(1);
        }

        const now = new Date();

        // Helper to snap to the start of the current hour
        const roundToHour = (date: Date): Date => {
            const rounded = new Date(date);
            rounded.setMinutes(0, 0, 0);
            return rounded;
        };

        const baseHour = roundToHour(now);

        // Helper to create dates relative to base hour (rounds to clean hours)
        const hoursFromNow = (hours: number) => new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
        const daysFromNow = (days: number) => new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

        const EVENTS_SEED = [
            // LIVE EVENT (started 1 hour ago, ends in 2 hours)
            {
                title: 'Heroic Amirdrassil Clear',
                description: 'Weekly heroic raid run. All welcome! BE-only pulls.',
                registryGameId: wowGame.id,
                gameId: '123', // WoW IGDB ID from games-seed.json
                startTime: hoursFromNow(-1), // Started 1 hour ago (clean hour)
                endTime: hoursFromNow(2),
            },
            // UPCOMING EVENT (in 2 hours)
            {
                title: 'Mythic+ Push Night',
                description: 'High key pushing session. Need 2 DPS, 1 tank.',
                registryGameId: wowGame.id,
                gameId: '123', // WoW IGDB ID from games-seed.json
                startTime: hoursFromNow(2),
                endTime: hoursFromNow(5),
            },
            // UPCOMING EVENT (tomorrow)
            {
                title: 'Valheim Boss Rush',
                description: 'Taking down all bosses in one session!',
                registryGameId: valheimGame?.id || null,
                gameId: '104967', // Valheim IGDB ID from games-seed.json
                startTime: daysFromNow(1),
                endTime: new Date(daysFromNow(1).getTime() + 3 * 60 * 60 * 1000),
            },
            // UPCOMING EVENT (in 3 days)
            {
                title: 'FFXIV Savage Prog',
                description: 'M4S progression - Phase 2 onwards. Know the fight!',
                registryGameId: ffxivGame?.id || null,
                gameId: '14729', // FFXIV IGDB ID from games-seed.json
                startTime: daysFromNow(3),
                endTime: new Date(daysFromNow(3).getTime() + 3 * 60 * 60 * 1000),
            },
            // ENDED EVENT (ended 2 hours ago)
            {
                title: 'Morning Dungeon Runs',
                description: 'Casual dungeon runs for alts.',
                registryGameId: wowGame.id,
                gameId: '123', // WoW IGDB ID from games-seed.json
                startTime: hoursFromNow(-4), // Started 4 hours ago (clean hour)
                endTime: hoursFromNow(-2), // Ended 2 hours ago (clean hour)
            },
            // UPCOMING EVENT (in 6 hours)
            {
                title: 'Late Night Raids',
                description: 'For the night owls. Normal mode farm.',
                registryGameId: wowGame.id,
                gameId: '123', // WoW IGDB ID from games-seed.json
                startTime: hoursFromNow(6),
                endTime: hoursFromNow(9),
            },
        ];

        console.log('\n  Creating events...\n');

        for (const eventData of EVENTS_SEED) {
            const { startTime, endTime, ...rest } = eventData;

            // Check if event already exists by title
            const existing = await db
                .select()
                .from(schema.events)
                .where(eq(schema.events.title, eventData.title))
                .limit(1)
                .then((rows) => rows[0]);

            if (existing) {
                console.log(`  ⏭️  Skipped: ${eventData.title} (already exists)`);
                continue;
            }

            await db.insert(schema.events).values({
                ...rest,
                creatorId: seedUser.id,
                duration: [startTime, endTime],
            });

            const status =
                now < startTime ? '🔵 UPCOMING' :
                    now >= startTime && now <= endTime ? '🟢 LIVE' : '⚫ ENDED';

            console.log(`  ✅ Created: ${eventData.title} (${status})`);
        }

        console.log('\n🎉 Event seeding complete!');
        console.log('\n📍 View events at: http://localhost:5173/events');
    } catch (err) {
        console.error('❌ Seeding failed:', err);
        await app.close();
        process.exit(1);
    }

    await app.close();
    process.exit(0);
}

bootstrap();
