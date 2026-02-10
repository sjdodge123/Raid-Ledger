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
 * enabling game search and discovery to work without requiring IGDB API keys.
 *
 * Uses upsert (ON CONFLICT DO UPDATE) to safely re-run without duplicates.
 * Writes all expanded fields (summary, rating, gameModes, screenshots, etc.)
 */

interface GameSeed {
    igdbId: number;
    name: string;
    slug: string;
    coverUrl: string | null;
    genres?: number[];
    summary?: string | null;
    rating?: number | null;
    aggregatedRating?: number | null;
    popularity?: number | null;
    gameModes?: number[];
    themes?: number[];
    platforms?: number[];
    screenshots?: string[];
    videos?: { name: string; videoId: string }[];
    firstReleaseDate?: string | null;
    playerCount?: { min: number; max: number } | null;
    twitchGameId?: string | null;
    crossplay?: boolean | null;
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
        let failed = 0;

        for (let i = 0; i < seedData.games.length; i++) {
            const game = seedData.games[i];

            try {
                const values = {
                    igdbId: game.igdbId,
                    name: game.name,
                    slug: game.slug,
                    coverUrl: game.coverUrl,
                    genres: game.genres ?? [],
                    summary: game.summary ?? null,
                    rating: game.rating ?? null,
                    aggregatedRating: game.aggregatedRating ?? null,
                    popularity: game.popularity ?? null,
                    gameModes: game.gameModes ?? [],
                    themes: game.themes ?? [],
                    platforms: game.platforms ?? [],
                    screenshots: game.screenshots ?? [],
                    videos: game.videos ?? [],
                    firstReleaseDate: game.firstReleaseDate
                        ? new Date(game.firstReleaseDate)
                        : null,
                    playerCount: game.playerCount ?? null,
                    twitchGameId: game.twitchGameId ?? null,
                    crossplay: game.crossplay ?? null,
                };

                // Upsert: insert or update all fields on conflict
                const result = await db
                    .insert(schema.games)
                    .values(values)
                    .onConflictDoUpdate({
                        target: schema.games.igdbId,
                        set: {
                            name: values.name,
                            slug: values.slug,
                            coverUrl: values.coverUrl,
                            genres: values.genres,
                            summary: values.summary,
                            rating: values.rating,
                            aggregatedRating: values.aggregatedRating,
                            popularity: values.popularity,
                            gameModes: values.gameModes,
                            themes: values.themes,
                            platforms: values.platforms,
                            screenshots: values.screenshots,
                            videos: values.videos,
                            firstReleaseDate: values.firstReleaseDate,
                            playerCount: values.playerCount,
                            twitchGameId: values.twitchGameId,
                            crossplay: values.crossplay,
                            cachedAt: new Date(),
                        },
                    })
                    .returning();

                if (result.length > 0) {
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
