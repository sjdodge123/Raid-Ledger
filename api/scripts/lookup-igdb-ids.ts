#!/usr/bin/env npx tsx
/**
 * Script to look up correct IGDB IDs for games by name.
 * Run this to find the right IDs for games that have incorrect mappings.
 * 
 * Usage:
 *   IGDB_CLIENT_ID=xxx IGDB_CLIENT_SECRET=xxx npx tsx api/scripts/lookup-igdb-ids.ts
 */

import * as fs from 'fs';
import * as path from 'path';

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

async function getAccessToken(): Promise<string> {
    const clientId = process.env.IGDB_CLIENT_ID;
    const clientSecret = process.env.IGDB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables are required');
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
        }),
    });

    if (!response.ok) throw new Error('Failed to get access token');
    const data = await response.json() as { access_token: string };
    return data.access_token;
}

async function searchGame(name: string, token: string): Promise<IgdbApiGame[]> {
    const clientId = process.env.IGDB_CLIENT_ID!;
    const sanitizedName = name.replace(/"/g, '\\"');

    const response = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
            'Client-ID': clientId,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain',
        },
        body: `search "${sanitizedName}"; fields name, slug, cover.image_id; limit 5;`,
    });

    if (!response.ok) throw new Error(`IGDB API error: ${response.status}`);
    return await response.json() as IgdbApiGame[];
}

// Games we know have wrong IDs based on slug mismatch
const GAMES_TO_FIX = [
    'Deep Rock Galactic',
    'Diablo IV',
    'Apex Legends',
    'Overwatch 2',
    'Fortnite',
    'Counter-Strike 2',
    'PlayerUnknown\'s Battlegrounds',
    'Smite 2',
    'Dead by Daylight',
    'Risk of Rain 2',
    'Lethal Company',
    'Content Warning',
    'Phasmophobia',
    'Helldivers 2',
    'Minecraft',
];

async function main() {
    console.log('=== IGDB ID Lookup ===\n');

    const token = await getAccessToken();
    console.log('✓ Authenticated\n');

    // Read current seed for comparison
    const seedPath = path.join(__dirname, '..', 'seeds', 'games-seed.json');
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as GamesSeedFile;
    const seedByName = new Map(seedData.games.map(g => [g.name, g]));

    console.log('Looking up correct IGDB IDs for mismatched games...\n');

    const corrections: Array<{ name: string; currentId: number; suggestedId: number; suggestedSlug: string }> = [];

    for (const gameName of GAMES_TO_FIX) {
        const seedGame = seedByName.get(gameName);
        if (!seedGame) {
            console.log(`⚠ "${gameName}" not found in seed file`);
            continue;
        }

        console.log(`\n🔍 ${gameName} (current ID: ${seedGame.igdbId}, slug: ${seedGame.slug})`);

        const results = await searchGame(gameName, token);

        if (results.length === 0) {
            console.log('   No results found');
            continue;
        }

        console.log('   Results:');
        for (const r of results) {
            const marker = r.slug.includes(gameName.toLowerCase().split(' ')[0].split(':')[0]) ? '✓' : ' ';
            console.log(`   ${marker} ID: ${r.id} | slug: ${r.slug} | name: ${r.name}`);

            // Auto-suggest the best match
            if (r.id !== seedGame.igdbId && r.slug.toLowerCase().includes(gameName.toLowerCase().split(':')[0].split(' ')[0])) {
                corrections.push({
                    name: gameName,
                    currentId: seedGame.igdbId,
                    suggestedId: r.id,
                    suggestedSlug: r.slug,
                });
            }
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (corrections.length > 0) {
        console.log('\n\n=== SUGGESTED CORRECTIONS ===\n');
        for (const c of corrections) {
            console.log(`"${c.name}": ${c.currentId} → ${c.suggestedId} (${c.suggestedSlug})`);
        }
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
