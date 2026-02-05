#!/usr/bin/env npx tsx
/**
 * Script to regenerate games-seed.json with correct cover URLs from IGDB API.
 * 
 * This script:
 * 1. Reads the current games-seed.json
 * 2. For each game, fetches the correct cover URL from IGDB using the igdbId
 * 3. Updates the coverUrl field with the correct value
 * 4. Writes the updated JSON back to games-seed.json
 * 
 * Environment Variables (required):
 *   IGDB_CLIENT_ID     - Twitch/IGDB Client ID
 *   IGDB_CLIENT_SECRET - Twitch/IGDB Client Secret
 * 
 * CLI Arguments:
 *   --dry-run    Don't write changes, just show what would be updated
 *   --json       Output results as JSON (useful for CI/CD)
 *   --silent     Suppress console output except errors
 * 
 * Exit Codes:
 *   0 - Success
 *   1 - Error (credentials missing, API error, etc.)
 * 
 * Usage:
 *   # Interactive (for local development)
 *   IGDB_CLIENT_ID=xxx IGDB_CLIENT_SECRET=xxx npx tsx api/scripts/refresh-game-covers.ts
 * 
 *   # CI/CD (GitHub Actions monthly workflow)
 *   IGDB_CLIENT_ID=${{ secrets.IGDB_CLIENT_ID }} \
 *   IGDB_CLIENT_SECRET=${{ secrets.IGDB_CLIENT_SECRET }} \
 *   npx tsx api/scripts/refresh-game-covers.ts --json
 * 
 * @see ROK-XXX Monthly game cover refresh GitHub Action (backlog)
 */

import * as fs from 'fs';
import * as path from 'path';

/** IGDB API game response structure */
interface IgdbApiGame {
    id: number;
    name: string;
    slug: string;
    cover?: {
        image_id: string;
    };
}

interface GameSeedEntry {
    igdbId: number;
    name: string;
    slug: string;
    coverUrl: string | null;
}

interface GamesSeedFile {
    version: string;
    generatedAt: string;
    source: string;
    description: string;
    games: GameSeedEntry[];
}

interface RefreshResult {
    success: boolean;
    totalGames: number;
    updated: number;
    noChange: number;
    notFound: number;
    errors: string[];
    updatedGames: Array<{
        name: string;
        igdbId: number;
        oldCoverUrl: string | null;
        newCoverUrl: string | null;
    }>;
}

const IGDB_COVER_URL_BASE = 'https://images.igdb.com/igdb/image/upload/t_cover_big';

// Parse CLI arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const JSON_OUTPUT = args.includes('--json');
const SILENT = args.includes('--silent');

function log(...messages: unknown[]) {
    if (!SILENT && !JSON_OUTPUT) {
        console.log(...messages);
    }
}

async function getAccessToken(): Promise<string> {
    const clientId = process.env.IGDB_CLIENT_ID;
    const clientSecret = process.env.IGDB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables are required');
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
}

async function fetchGamesByIds(ids: number[], token: string): Promise<Map<number, IgdbApiGame>> {
    const clientId = process.env.IGDB_CLIENT_ID!;

    // IGDB allows fetching multiple games by ID in one request
    const idsQuery = ids.join(',');

    const response = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
            'Client-ID': clientId,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain',
        },
        body: `where id = (${idsQuery}); fields name, slug, cover.image_id; limit 500;`,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`IGDB API error: ${response.status} ${errorText}`);
    }

    const games = await response.json() as IgdbApiGame[];
    const gameMap = new Map<number, IgdbApiGame>();

    for (const game of games) {
        gameMap.set(game.id, game);
    }

    return gameMap;
}

async function refreshGameCovers(): Promise<RefreshResult> {
    const result: RefreshResult = {
        success: true,
        totalGames: 0,
        updated: 0,
        noChange: 0,
        notFound: 0,
        errors: [],
        updatedGames: [],
    };

    // Read current games-seed.json
    const seedPath = path.join(__dirname, '..', 'seeds', 'games-seed.json');
    const seedContent = fs.readFileSync(seedPath, 'utf-8');
    const seedData = JSON.parse(seedContent) as GamesSeedFile;

    result.totalGames = seedData.games.length;
    log(`Loaded ${seedData.games.length} games from games-seed.json`);

    // Get access token
    log('Authenticating with IGDB...');
    const token = await getAccessToken();
    log('✓ Authenticated\n');

    // Fetch all games from IGDB in batches
    const igdbIds = seedData.games.map(g => g.igdbId);
    log(`Fetching ${igdbIds.length} games from IGDB API...`);

    const batchSize = 100;
    const allGames = new Map<number, IgdbApiGame>();

    for (let i = 0; i < igdbIds.length; i += batchSize) {
        const batch = igdbIds.slice(i, i + batchSize);
        log(`  Batch ${Math.floor(i / batchSize) + 1}: fetching ${batch.length} games...`);
        const batchGames = await fetchGamesByIds(batch, token);

        for (const [id, game] of batchGames) {
            allGames.set(id, game);
        }

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < igdbIds.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    log(`✓ Fetched ${allGames.size} games from IGDB\n`);

    // Update cover URLs
    for (const seedGame of seedData.games) {
        const igdbGame = allGames.get(seedGame.igdbId);

        if (!igdbGame) {
            log(`⚠ Not found in IGDB: ${seedGame.name} (ID: ${seedGame.igdbId})`);
            result.notFound++;
            result.errors.push(`Game not found: ${seedGame.name} (ID: ${seedGame.igdbId})`);
            continue;
        }

        // Also update slug from IGDB (canonical source)
        const newSlug = igdbGame.slug;
        const newCoverUrl = igdbGame.cover
            ? `${IGDB_COVER_URL_BASE}/${igdbGame.cover.image_id}.jpg`
            : null;

        if (seedGame.coverUrl !== newCoverUrl || seedGame.slug !== newSlug) {
            log(`✓ Updated: ${seedGame.name}`);
            log(`    Old cover: ${seedGame.coverUrl}`);
            log(`    New cover: ${newCoverUrl}`);
            if (seedGame.slug !== newSlug) {
                log(`    Old slug: ${seedGame.slug}`);
                log(`    New slug: ${newSlug}`);
            }

            result.updatedGames.push({
                name: seedGame.name,
                igdbId: seedGame.igdbId,
                oldCoverUrl: seedGame.coverUrl,
                newCoverUrl,
            });

            seedGame.coverUrl = newCoverUrl!;
            seedGame.slug = newSlug;
            result.updated++;
        } else {
            result.noChange++;
        }
    }

    log(`\n=== Summary ===`);
    log(`Updated: ${result.updated}`);
    log(`No change: ${result.noChange}`);
    log(`Not found: ${result.notFound}`);

    if (!DRY_RUN && result.updated > 0) {
        // Update metadata
        seedData.generatedAt = new Date().toISOString().split('T')[0];

        // Write updated file
        fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 4) + '\n');
        log(`\n✓ Written to ${seedPath}`);
    } else if (DRY_RUN) {
        log('\n[DRY RUN] No changes written to disk');
    }

    return result;
}

async function main() {
    log('=== Refreshing Game Covers from IGDB ===\n');
    if (DRY_RUN) log('[DRY RUN MODE]\n');

    try {
        const result = await refreshGameCovers();

        if (JSON_OUTPUT) {
            console.log(JSON.stringify(result, null, 2));
        }

        process.exit(result.success ? 0 : 1);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (JSON_OUTPUT) {
            console.log(JSON.stringify({
                success: false,
                error: errorMessage,
            }, null, 2));
        } else {
            console.error('Error:', errorMessage);
        }

        process.exit(1);
    }
}

main();
