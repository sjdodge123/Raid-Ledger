import { NestFactory } from '@nestjs/core';
import { Module, Inject } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule, DrizzleAsyncProvider } from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Seed data for the game registry.
 * This is deterministic and idempotent (uses ON CONFLICT DO NOTHING).
 */
const GAMES_SEED = [
    {
        slug: 'wow',
        name: 'World of Warcraft',
        iconUrl: 'https://assets.blizzard.com/wow/icon.png',
        colorHex: '#F58518',
        hasRoles: true,
        hasSpecs: true,
        maxCharactersPerUser: 10,
        eventTypes: [
            {
                slug: 'mythic-raid',
                name: 'Mythic Raid',
                defaultPlayerCap: 20,
                defaultDurationMinutes: 180,
                requiresComposition: true,
            },
            {
                slug: 'heroic-raid',
                name: 'Heroic Raid',
                defaultPlayerCap: 30,
                defaultDurationMinutes: 180,
                requiresComposition: true,
            },
            {
                slug: 'normal-raid',
                name: 'Normal Raid',
                defaultPlayerCap: 30,
                defaultDurationMinutes: 150,
                requiresComposition: true,
            },
            {
                slug: 'mythic-plus',
                name: 'Mythic+ Dungeon',
                defaultPlayerCap: 5,
                defaultDurationMinutes: 60,
                requiresComposition: true,
            },
            {
                slug: 'delve',
                name: 'Delve',
                defaultPlayerCap: 5,
                defaultDurationMinutes: 30,
                requiresComposition: false,
            },
        ],
    },
    {
        slug: 'wow-classic',
        name: 'World of Warcraft Classic',
        iconUrl: 'https://assets.blizzard.com/wow/icon.png',
        colorHex: '#C79C6E',
        hasRoles: true,
        hasSpecs: true,
        maxCharactersPerUser: 10,
        eventTypes: [
            {
                slug: 'classic-40-raid',
                name: '40-Man Raid',
                defaultPlayerCap: 40,
                defaultDurationMinutes: 240,
                requiresComposition: true,
            },
            {
                slug: 'classic-25-raid',
                name: '25-Man Raid',
                defaultPlayerCap: 25,
                defaultDurationMinutes: 180,
                requiresComposition: true,
            },
            {
                slug: 'classic-10-raid',
                name: '10-Man Raid',
                defaultPlayerCap: 10,
                defaultDurationMinutes: 120,
                requiresComposition: true,
            },
            {
                slug: 'classic-dungeon',
                name: 'Dungeon',
                defaultPlayerCap: 5,
                defaultDurationMinutes: 60,
                requiresComposition: true,
            },
        ],
    },
    {
        slug: 'valheim',
        name: 'Valheim',
        iconUrl: null,
        colorHex: '#4A7C59',
        hasRoles: false,
        hasSpecs: false,
        maxCharactersPerUser: 5,
        eventTypes: [
            {
                slug: 'boss-raid',
                name: 'Boss Raid',
                defaultPlayerCap: 10,
                defaultDurationMinutes: 120,
                requiresComposition: false,
            },
            {
                slug: 'exploration',
                name: 'Exploration',
                defaultPlayerCap: 10,
                defaultDurationMinutes: 120,
                requiresComposition: false,
            },
            {
                slug: 'building',
                name: 'Building Session',
                defaultPlayerCap: 10,
                defaultDurationMinutes: 180,
                requiresComposition: false,
            },
        ],
    },
    {
        slug: 'ffxiv',
        name: 'Final Fantasy XIV Online',
        iconUrl: null,
        colorHex: '#5D5CDE',
        hasRoles: true,
        hasSpecs: true,
        maxCharactersPerUser: 8,
        eventTypes: [
            {
                slug: 'savage-raid',
                name: 'Savage Raid',
                defaultPlayerCap: 8,
                defaultDurationMinutes: 180,
                requiresComposition: true,
            },
            {
                slug: 'extreme-trial',
                name: 'Extreme Trial',
                defaultPlayerCap: 8,
                defaultDurationMinutes: 60,
                requiresComposition: true,
            },
            {
                slug: 'alliance-raid',
                name: 'Alliance Raid',
                defaultPlayerCap: 24,
                defaultDurationMinutes: 120,
                requiresComposition: false,
            },
        ],
    },
    {
        slug: 'generic',
        name: 'Generic',
        iconUrl: null,
        colorHex: '#6B7280',
        hasRoles: false,
        hasSpecs: false,
        maxCharactersPerUser: 1,
        eventTypes: [
            {
                slug: 'custom-event',
                name: 'Custom Event',
                defaultPlayerCap: null,
                defaultDurationMinutes: 120,
                requiresComposition: false,
            },
        ],
    },
];

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        DrizzleModule,
    ],
})
class SeedModule { }

async function bootstrap() {
    console.log('🌱 Seeding game registry...\n');

    const app = await NestFactory.createApplicationContext(SeedModule);
    const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

    try {
        for (const gameData of GAMES_SEED) {
            const { eventTypes, ...game } = gameData;

            // Insert game (or get existing)
            const [insertedGame] = await db
                .insert(schema.gameRegistry)
                .values(game)
                .onConflictDoNothing({ target: schema.gameRegistry.slug })
                .returning();

            // If game already existed, fetch it
            let gameId: string;
            if (insertedGame) {
                gameId = insertedGame.id;
                console.log(`  ✅ Created game: ${game.name} (${game.slug})`);
            } else {
                const [existing] = await db
                    .select()
                    .from(schema.gameRegistry)
                    .where(eq(schema.gameRegistry.slug, game.slug))
                    .limit(1);
                gameId = existing.id;
                console.log(`  ⏭️  Skipped game: ${game.name} (already exists)`);
            }

            // Insert event types
            for (const eventType of eventTypes) {
                const [insertedType] = await db
                    .insert(schema.eventTypes)
                    .values({
                        gameId,
                        ...eventType,
                    })
                    .onConflictDoNothing()
                    .returning();

                if (insertedType) {
                    console.log(`      ✅ Created event type: ${eventType.name}`);
                } else {
                    console.log(`      ⏭️  Skipped event type: ${eventType.name} (already exists)`);
                }
            }
            console.log('');
        }

        console.log('🎉 Game registry seeding complete!');
    } catch (err) {
        console.error('❌ Seeding failed:', err);
        await app.close();
        process.exit(1);
    }

    await app.close();
    process.exit(0);
}

bootstrap();
