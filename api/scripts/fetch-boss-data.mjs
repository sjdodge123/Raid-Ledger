#!/usr/bin/env node
/**
 * One-time script: Fetches boss encounters and loot from the Blizzard Journal API
 * for all Classic/TBC instances missing from boss-encounter-data.json.
 *
 * Usage: node api/scripts/fetch-boss-data.mjs
 *
 * Requires:
 *   - DATABASE_URL and JWT_SECRET env vars (or dev defaults)
 *   - Blizzard credentials configured in the app_settings table
 */

import { createDecipheriv, scryptSync } from 'crypto';
import postgres from 'postgres';
import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'plugins', 'wow-common', 'data');

const REGION = 'us';
const NAMESPACE = `static-${REGION}`;
const BASE_URL = `https://${REGION}.api.blizzard.com`;

// --- Encryption (mirrors encryption.util.ts) ---
function getEncryptionKey() {
  const secret = process.env.JWT_SECRET || 'dev-encryption-key-change-me';
  const SALT_LENGTH = 32;
  const salt = Buffer.from(secret.slice(0, SALT_LENGTH).padEnd(SALT_LENGTH, '0'));
  return scryptSync(secret, salt, 32);
}

function decrypt(encryptedText) {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// --- DB + Blizzard Auth ---
async function getBlizzardCredentials() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/raid_ledger';
  const sql = postgres(dbUrl);
  const rows = await sql`SELECT key, encrypted_value FROM app_settings WHERE key IN ('blizzard_client_id', 'blizzard_client_secret')`;
  await sql.end();
  const map = {};
  for (const row of rows) {
    map[row.key] = decrypt(row.encrypted_value);
  }
  return { clientId: map.blizzard_client_id, clientSecret: map.blizzard_client_secret };
}

async function getAccessToken(clientId, clientSecret) {
  const res = await fetch(`https://${REGION}.battle.net/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// --- Blizzard Journal API ---
async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.warn(`  WARN: ${url} → ${res.status}`);
    return null;
  }
  return res.json();
}

async function fetchJournalInstance(instanceId, token) {
  return fetchJson(
    `${BASE_URL}/data/wow/journal-instance/${instanceId}?namespace=${NAMESPACE}&locale=en_US`,
    token
  );
}

async function fetchJournalEncounter(encounterId, token) {
  return fetchJson(
    `${BASE_URL}/data/wow/journal-encounter/${encounterId}?namespace=${NAMESPACE}&locale=en_US`,
    token
  );
}

async function fetchItem(itemId, token) {
  return fetchJson(
    `${BASE_URL}/data/wow/item/${itemId}?namespace=${NAMESPACE}&locale=en_US`,
    token
  );
}

async function fetchItemMedia(itemId, token) {
  return fetchJson(
    `${BASE_URL}/data/wow/media/item/${itemId}?namespace=${NAMESPACE}&locale=en_US`,
    token
  );
}

// --- Quality mapping ---
const QUALITY_MAP = {
  POOR: 'Poor',
  COMMON: 'Common',
  UNCOMMON: 'Uncommon',
  RARE: 'Rare',
  EPIC: 'Epic',
  LEGENDARY: 'Legendary',
};

// --- Slot mapping from Blizzard inventory_type ---
const SLOT_MAP = {
  HEAD: 'Head',
  NECK: 'Neck',
  SHOULDER: 'Shoulder',
  BODY: 'Shirt',
  CHEST: 'Chest',
  WAIST: 'Waist',
  LEGS: 'Legs',
  FEET: 'Feet',
  WRIST: 'Wrist',
  HAND: 'Hands',
  FINGER: 'Finger',
  TRINKET: 'Trinket',
  CLOAK: 'Back',
  WEAPON: 'One-Hand',
  SHIELD: 'Shield',
  RANGED: 'Ranged',
  RANGEDRIGHT: 'Ranged',
  TWOHWEAPON: 'Two-Hand',
  WEAPONMAINHAND: 'Main Hand',
  WEAPONOFFHAND: 'Off Hand',
  HOLDABLE: 'Held In Off-hand',
  THROWN: 'Ranged',
  NON_EQUIP: null,
  RELIC: 'Relic',
  TABARD: null,
  BAG: null,
  AMMO: null,
};

// --- Expansion mapping: journal expansion name → seed expansion key ---
const EXPANSION_MAP = {
  'Classic': 'classic',
  'Burning Crusade': 'tbc',
  'Wrath of the Lich King': 'wotlk',
  'Cataclysm': 'cata',
};

// --- Sub-instance parent mapping ---
const SUB_INSTANCE_PARENTS = {
  // Dire Maul variants
  230: 230,   // DM:East — standalone journal entry
  1276: 1276, // DM:West — standalone journal entry
  1277: 1277, // DM:North — standalone journal entry
  // Stratholme variants
  236: 236,   // Strat:Live — standalone
  1292: 1292, // Strat:UD — standalone
  // Maraudon sub-instances
  23201: 232,
  23202: 232,
  23203: 232,
  // SM sub-instances
  31601: 316,
  31602: 316,
  31603: 316,
  31604: 316,
};

// Instances that need boss data — all Classic through Cata
// Only includes instances NOT already in the JSON files
const MISSING_INSTANCES = [
  // WotLK dungeons
  { id: 271, expansion: 'wotlk' },  // Ahn'kahet: The Old Kingdom
  { id: 272, expansion: 'wotlk' },  // Azjol-Nerub
  { id: 273, expansion: 'wotlk' },  // Drak'Tharon Keep
  { id: 274, expansion: 'wotlk' },  // Gundrak
  { id: 275, expansion: 'wotlk' },  // Halls of Lightning
  { id: 276, expansion: 'wotlk' },  // Halls of Reflection
  { id: 277, expansion: 'wotlk' },  // Halls of Stone
  { id: 278, expansion: 'wotlk' },  // Pit of Saron
  { id: 279, expansion: 'wotlk' },  // The Culling of Stratholme
  { id: 280, expansion: 'wotlk' },  // The Forge of Souls
  { id: 281, expansion: 'wotlk' },  // The Nexus
  { id: 282, expansion: 'wotlk' },  // The Oculus
  { id: 283, expansion: 'wotlk' },  // The Violet Hold
  { id: 284, expansion: 'wotlk' },  // Trial of the Champion
  { id: 286, expansion: 'wotlk' },  // Utgarde Pinnacle
  // WotLK raids
  { id: 753, expansion: 'wotlk' },  // Vault of Archavon
  { id: 755, expansion: 'wotlk' },  // The Obsidian Sanctum
  { id: 756, expansion: 'wotlk' },  // The Eye of Eternity
  { id: 757, expansion: 'wotlk' },  // Trial of the Crusader
  { id: 761, expansion: 'wotlk' },  // The Ruby Sanctum
  // Cata dungeons
  { id: 65, expansion: 'cata' },   // Throne of the Tides
  { id: 66, expansion: 'cata' },   // Blackrock Caverns
  { id: 67, expansion: 'cata' },   // The Stonecore
  { id: 68, expansion: 'cata' },   // The Vortex Pinnacle
  { id: 69, expansion: 'cata' },   // Lost City of the Tol'vir
  { id: 70, expansion: 'cata' },   // Halls of Origination
  { id: 71, expansion: 'cata' },   // Grim Batol
  { id: 76, expansion: 'cata' },   // Zul'Gurub
  { id: 77, expansion: 'cata' },   // Zul'Aman
  { id: 184, expansion: 'cata' },  // End Time
  { id: 185, expansion: 'cata' },  // Well of Eternity
  { id: 186, expansion: 'cata' },  // Hour of Twilight
  // Cata raids
  { id: 72, expansion: 'cata' },   // The Bastion of Twilight
  { id: 74, expansion: 'cata' },   // Throne of the Four Winds
  { id: 75, expansion: 'cata' },   // Baradin Hold
  { id: 1301, expansion: 'cata' }, // Blackrock Depths (Cata raid version)
];

// Rate limiter
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Blizzard Journal Boss & Loot Data Fetcher ===\n');

  // 1. Get credentials and token
  console.log('Getting Blizzard API credentials...');
  const { clientId, clientSecret } = await getBlizzardCredentials();
  console.log('Fetching access token...');
  const token = await getAccessToken(clientId, clientSecret);
  console.log('Token acquired.\n');

  // 2. Load existing data
  const existingBosses = JSON.parse(await readFile(join(DATA_DIR, 'boss-encounter-data.json'), 'utf-8'));
  const existingLoot = JSON.parse(await readFile(join(DATA_DIR, 'boss-loot-data.json'), 'utf-8'));

  const newBosses = [];
  const newLoot = [];
  let totalBosses = 0;
  let totalLoot = 0;

  // 3. Fetch data for each missing instance
  for (const inst of MISSING_INSTANCES) {
    console.log(`\n--- Fetching instance ${inst.id} (${inst.expansion}) ---`);
    const journalInst = await fetchJournalInstance(inst.id, token);
    await sleep(100);

    if (!journalInst) {
      console.log(`  Skipping — journal instance not found`);
      continue;
    }

    const encounters = journalInst.encounters || [];
    console.log(`  ${journalInst.name}: ${encounters.length} encounters`);

    for (let i = 0; i < encounters.length; i++) {
      const enc = encounters[i];
      const bossName = enc.name;
      const bossEntry = {
        instanceId: inst.id,
        name: bossName,
        order: i + 1,
        expansion: inst.expansion,
        sodModified: false,
      };
      newBosses.push(bossEntry);
      totalBosses++;
      console.log(`  Boss ${i + 1}: ${bossName}`);

      // Fetch encounter detail for loot
      const encDetail = await fetchJournalEncounter(enc.id, token);
      await sleep(100);

      if (!encDetail) continue;

      // Process loot items
      const items = encDetail.items || [];
      let lootCount = 0;

      for (const itemEntry of items) {
        const item = itemEntry.item;
        if (!item || !item.id) continue;

        // Fetch item details for quality, slot, item level
        const itemDetail = await fetchItem(item.id, token);
        await sleep(50);

        if (!itemDetail) continue;

        const quality = QUALITY_MAP[itemDetail.quality?.type] || 'Common';
        // Skip common/poor quality items (quest items, junk)
        if (quality === 'Poor' || quality === 'Common') continue;

        const slotType = itemDetail.inventory_type?.type || '';
        const slot = SLOT_MAP[slotType] || null;

        // Fetch item media for icon
        const media = await fetchItemMedia(item.id, token);
        await sleep(50);
        const iconUrl = media?.assets?.[0]?.value || null;

        const lootEntry = {
          bossName,
          expansion: inst.expansion,
          itemId: item.id,
          itemName: item.name || itemDetail.name || `Item ${item.id}`,
          slot,
          quality,
          itemLevel: itemDetail.level || null,
          dropRate: null, // Blizzard API doesn't provide drop rates
          classRestrictions: null,
          iconUrl,
          itemSubclass: itemDetail.item_subclass?.name || null,
        };
        newLoot.push(lootEntry);
        lootCount++;
      }
      console.log(`    → ${lootCount} loot items`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`New bosses: ${totalBosses}`);
  console.log(`New loot items: ${totalLoot = newLoot.length}`);

  // 4. Merge and write
  const mergedBosses = [...existingBosses, ...newBosses];
  const mergedLoot = [...existingLoot, ...newLoot];

  await writeFile(
    join(DATA_DIR, 'boss-encounter-data.json'),
    JSON.stringify(mergedBosses, null, 2) + '\n'
  );
  await writeFile(
    join(DATA_DIR, 'boss-loot-data.json'),
    JSON.stringify(mergedLoot, null, 2) + '\n'
  );

  console.log(`\nWrote ${mergedBosses.length} total bosses to boss-encounter-data.json`);
  console.log(`Wrote ${mergedLoot.length} total loot items to boss-loot-data.json`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
