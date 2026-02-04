import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule, DrizzleAsyncProvider } from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Seed testing data: signups and availability windows.
 * Run AFTER seed-games.ts and seed-events.ts.
 * This creates deterministic test data for /verify-ui workflows.
 */

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        DrizzleModule,
    ],
})
class SeedTestingModule { }

async function bootstrap() {
    console.log('🧪 Seeding test fixtures (signups + availability)...\n');

    const app = await NestFactory.createApplicationContext(SeedTestingModule);
    const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

    try {
        // Get SeedAdmin user
        const seedUser = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.username, 'SeedAdmin'))
            .limit(1)
            .then((rows) => rows[0]);

        if (!seedUser) {
            console.error('❌ SeedAdmin user not found! Run seed-events.ts first.');
            process.exit(1);
        }

        console.log(`  Found user: ${seedUser.username}\n`);

        // Get all upcoming events
        const now = new Date();
        const events = await db
            .select()
            .from(schema.events)
            .then((rows) => rows.filter((e) => {
                const [start] = e.duration as unknown as [Date, Date];
                return new Date(start) > now;
            }));

        console.log(`  Found ${events.length} upcoming events\n`);

        // Create signups for each upcoming event
        console.log('  Creating signups...\n');
        for (const event of events) {
            const existing = await db
                .select()
                .from(schema.eventSignups)
                .where(
                    and(
                        eq(schema.eventSignups.eventId, event.id),
                        eq(schema.eventSignups.userId, seedUser.id)
                    )
                )
                .limit(1)
                .then((rows) => rows[0]);

            if (existing) {
                console.log(`    ⏭️  Skipped signup for: ${event.title} (already exists)`);
                continue;
            }

            await db.insert(schema.eventSignups).values({
                eventId: event.id,
                userId: seedUser.id,
                confirmationStatus: 'pending',
            });

            console.log(`    ✅ Created signup for: ${event.title}`);
        }

        // Create availability windows for SeedAdmin
        console.log('\n  Creating availability windows...\n');

        // Helper to create dates relative to now
        const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000);

        const AVAILABILITY_WINDOWS = [
            {
                startTime: hoursFromNow(1),
                endTime: hoursFromNow(4),
                status: 'available' as const,
            },
            {
                startTime: hoursFromNow(24),
                endTime: hoursFromNow(28),
                status: 'available' as const,
            },
            {
                startTime: hoursFromNow(48),
                endTime: hoursFromNow(52),
                status: 'available' as const,
            },
        ];

        for (const window of AVAILABILITY_WINDOWS) {
            // Check for overlapping availability (simplified check)
            const existingCount = await db
                .select({ count: sql<number>`count(*)` })
                .from(schema.availability)
                .where(eq(schema.availability.userId, seedUser.id))
                .then((rows) => Number(rows[0]?.count) || 0);

            if (existingCount >= 3) {
                console.log(`    ⏭️  Skipped availability window (user already has ${existingCount} windows)`);
                continue;
            }

            await db.insert(schema.availability).values({
                userId: seedUser.id,
                timeRange: [window.startTime, window.endTime],
                status: window.status,
            });

            console.log(`    ✅ Created availability: ${window.startTime.toLocaleString()} - ${window.endTime.toLocaleString()}`);
        }

        console.log('\n🎉 Test fixtures seeding complete!');
    } catch (err) {
        console.error('❌ Seeding failed:', err);
        process.exit(1);
    } finally {
        await app.close();
    }
}

bootstrap();
