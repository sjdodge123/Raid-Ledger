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

// Fake gamer data
const FAKE_GAMERS = [
    { username: 'ShadowMage', avatar: null },
    { username: 'DragonSlayer99', avatar: null },
    { username: 'HealzForDayz', avatar: null },
    { username: 'TankMaster', avatar: null },
    { username: 'NightOwlGamer', avatar: null },
    { username: 'CasualCarl', avatar: null },
    { username: 'ProRaider', avatar: null },
    { username: 'LootGoblin', avatar: null },
];

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
        // Create Event Signups
        // =====================
        console.log('\n📝 Creating event signups...\n');

        const allEvents = await db.select().from(schema.events);

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
                    await db.insert(schema.eventSignups).values({
                        eventId: event.id,
                        userId: user.id,
                        confirmationStatus: Math.random() > 0.3 ? 'confirmed' : 'pending',
                    });
                    console.log(`  ✅ ${user.username} → ${event.title}`);
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
