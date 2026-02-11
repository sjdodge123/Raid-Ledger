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
 * Seed sample notifications for DEMO mode.
 * Creates realistic notifications based on seeded events and users.
 */

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        DrizzleModule,
    ],
})
class SeedNotificationsModule { }

async function bootstrap() {
    console.log('🔔 Seeding sample notifications...\n');

    const app = await NestFactory.createApplicationContext(
        SeedNotificationsModule,
    );
    const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

    try {
        // Get admin user (roknua)
        const [adminUser] = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.username, 'roknua'))
            .limit(1);

        if (!adminUser) {
            console.log('⚠️  Admin user not found, skipping notification seeding');
            await app.close();
            process.exit(0);
        }

        // Get some seeded events
        const events = await db.select().from(schema.events).limit(5);

        if (events.length === 0) {
            console.log('⚠️  No events found, skipping notification seeding');
            await app.close();
            process.exit(0);
        }

        // Get some fake users
        const fakeUsers = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.isAdmin, false))
            .limit(3);

        // =====================
        // Create Sample Notifications
        // =====================

        const now = new Date();
        const hoursAgo = (hours: number) =>
            new Date(now.getTime() - hours * 60 * 60 * 1000);
        const daysAgo = (days: number) =>
            new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        const notifications: Array<typeof schema.notifications.$inferInsert> = [
            // Recent slot vacated notification (unread)
            {
                userId: adminUser.id,
                type: 'slot_vacated' as const,
                title: 'Roster Slot Available',
                message: `A Tank slot opened up in "${events[0]?.title || 'Raid Night'}" - claim it now!`,
                payload: { eventId: events[0]?.id, role: 'Tank', position: 1 },
                createdAt: hoursAgo(2),
                readAt: null,
            },
            // Event reminder (unread)
            {
                userId: adminUser.id,
                type: 'event_reminder' as const,
                title: 'Event Starting Soon',
                message: `"${events[1]?.title || 'Weekly Dungeon Run'}" starts in 24 hours. Don't forget to sign up!`,
                payload: { eventId: events[1]?.id },
                createdAt: hoursAgo(5),
                readAt: null,
            },
            // New event notification (unread)
            {
                userId: adminUser.id,
                type: 'new_event' as const,
                title: 'New Event Created',
                message: `${fakeUsers[0]?.username || 'A player'} created a new event: "${events[2]?.title || 'PvP Tournament'}"`,
                payload: { eventId: events[2]?.id },
                createdAt: hoursAgo(12),
                readAt: null,
            },
            // Subscribed game notification (read)
            {
                userId: adminUser.id,
                type: 'subscribed_game' as const,
                title: 'New Event for Your Favorite Game',
                message: `A new Valheim event has been scheduled: "${events[3]?.title || 'Boss Rush'}"`,
                payload: { eventId: events[3]?.id, gameId: 'valheim' },
                createdAt: daysAgo(1),
                readAt: hoursAgo(20),
            },
            // Another slot vacated (read)
            {
                userId: adminUser.id,
                type: 'slot_vacated' as const,
                title: 'Healer Needed',
                message: `A Healer slot is available in "${events[4]?.title || 'Mythic Raid'}"`,
                payload: { eventId: events[4]?.id, role: 'Healer', position: 2 },
                createdAt: daysAgo(2),
                readAt: daysAgo(1),
            },
            // Older event reminder (read)
            {
                userId: adminUser.id,
                type: 'event_reminder' as const,
                title: 'Event Tomorrow',
                message: `Don't forget about "${events[0]?.title || 'Raid Night'}" tomorrow at 8 PM`,
                payload: { eventId: events[0]?.id },
                createdAt: daysAgo(3),
                readAt: daysAgo(2),
            },
        ];

        let created = 0;
        let skipped = 0;

        for (const notif of notifications) {
            try {
                await db.insert(schema.notifications).values(notif);
                const icon = notif.readAt ? '📖' : '🔔';
                const status = notif.readAt ? '(read)' : '(unread)';
                console.log(`  ${icon} ${notif.type}: ${notif.title} ${status}`);
                created++;
            } catch {
                skipped++;
            }
        }

        // =====================
        // Create Default Preferences
        // =====================
        console.log('\n⚙️  Creating default notification preferences...\n');

        const allUsers = [adminUser, ...fakeUsers];

        for (const user of allUsers) {
            try {
                const [existing] = await db
                    .select()
                    .from(schema.userNotificationPreferences)
                    .where(eq(schema.userNotificationPreferences.userId, user.id))
                    .limit(1);

                if (!existing) {
                    await db.insert(schema.userNotificationPreferences).values({
                        userId: user.id,
                    });
                    console.log(`  ✅ Created preferences for ${user.username}`);
                } else {
                    console.log(`  ⏭️  Skipped: ${user.username} (exists)`);
                }
            } catch (err) {
                console.log(`  ⚠️  Failed to create preferences for ${user.username}`);
            }
        }

        console.log(`\n🎉 Notification seed complete!`);
        console.log(`   Created: ${created} notifications`);
        console.log(`   Skipped: ${skipped} (duplicates)`);
        console.log('\n📍 View notifications at: http://localhost:80 (click the bell icon)');
    } catch (err) {
        console.error('❌ Seeding failed:', err);
        await app.close();
        process.exit(1);
    }

    await app.close();
    process.exit(0);
}

bootstrap();
