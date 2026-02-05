import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule, DrizzleAsyncProvider } from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

/**
 * Seed IGDB games from static JSON file.
 * This populates the `games` table (IGDB cache) with pre-seeded games,
 * enabling game search to work without requiring IGDB API keys.
 *
 * Uses upsert (ON CONFLICT DO UPDATE) to safely re-run without duplicates.
 */

interface GameSeed {
    igdbId: number;
    name: string;
    slug: string;
    coverUrl: string | null;
}

interface GamesSeedFile {
    version: string;
    generatedAt: string;
    source: string;
    games: GameSeed[];
}

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        DrizzleModule,
    ],
})
class SeedModule { }

async function bootstrap() {
    console.log('🎮 Seeding IGDB games cache...\n');

    // Load seed data from JSON
    const seedPath = path.join(__dirname, '../seeds/games-seed.json');

    if (!fs.existsSync(seedPath)) {
        console.error(`❌ Seed file not found: ${seedPath}`);
        process.exit(1);
    }

    const seedData: GamesSeedFile = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    console.log(`📦 Loaded ${seedData.games.length} games from ${seedData.source} (v${seedData.version})\n`);

    const app = await NestFactory.createApplicationContext(SeedModule);
    const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

    try {
        let created = 0;
        let updated = 0;
        let failed = 0;

        for (let i = 0; i < seedData.games.length; i++) {
            const game = seedData.games[i];

            try {
                // Upsert: insert or update on conflict
                const result = await db
                    .insert(schema.games)
                    .values({
                        igdbId: game.igdbId,
                        name: game.name,
                        slug: game.slug,
                        coverUrl: game.coverUrl,
                    })
                    .onConflictDoUpdate({
                        target: schema.games.igdbId,
                        set: {
                            name: game.name,
                            slug: game.slug,
                            coverUrl: game.coverUrl,
                            cachedAt: new Date(),
                        },
                    })
                    .returning();

                if (result.length > 0) {
                    // Upsert always returns 1 row; we count all as successful
                    // Note: Drizzle onConflictDoUpdate doesn't distinguish insert vs update
                    created++;
                }

                // Progress logging every 10 games
                if ((i + 1) % 10 === 0) {
                    console.log(`  ⏳ Progress: ${i + 1}/${seedData.games.length} games processed...`);
                }
            } catch (err) {
                console.error(`  ❌ Failed to seed: ${game.name} (IGDB ID: ${game.igdbId})`, err);
                failed++;
            }
        }

        console.log('\n📊 Seeding Summary:');
        console.log(`  ✅ Processed: ${created} games`);
        if (failed > 0) {
            console.log(`  ❌ Failed: ${failed} games`);
        }
        console.log(`\n🎉 IGDB games cache seeding complete!`);
    } catch (err) {
        console.error('❌ Seeding failed:', err);
        await app.close();
        process.exit(1);
    }

    await app.close();
    process.exit(0);
}

bootstrap();
