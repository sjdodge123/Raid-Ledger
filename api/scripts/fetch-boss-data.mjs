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

// Instances that need boss data for classic_anniversary (classic + tbc)
// Excluding instances that already have data
const MISSING_INSTANCES = [
  // Classic dungeons
  { id: 226, expansion: 'classic' },  // Ragefire Chasm
  { id: 228, expansion: 'classic' },  // Blackrock Depths
  { id: 230, expansion: 'classic' },  // Dire Maul East
  { id: 232, expansion: 'classic' },  // Maraudon (parent)
  { id: 233, expansion: 'classic' },  // Razorfen Downs
  { id: 234, expansion: 'classic' },  // Razorfen Kraul
  { id: 236, expansion: 'classic' },  // Stratholme Live
  { id: 238, expansion: 'classic' },  // The Stockade
  { id: 239, expansion: 'classic' },  // Uldaman
  { id: 240, expansion: 'classic' },  // Wailing Caverns
  { id: 241, expansion: 'classic' },  // Zul'Farrak
  { id: 246, expansion: 'classic' },  // Scholomance
  { id: 311, expansion: 'classic' },  // Scarlet Halls
  { id: 1276, expansion: 'classic' }, // Dire Maul West
  { id: 1277, expansion: 'classic' }, // Dire Maul North
  { id: 1292, expansion: 'classic' }, // Stratholme UD
  // Classic raids
  { id: 743, expansion: 'classic' },  // Ruins of Ahn'Qiraj (AQ20)
  // TBC dungeons
  { id: 247, expansion: 'tbc' },  // Auchenai Crypts
  { id: 249, expansion: 'tbc' },  // Magisters' Terrace
  { id: 250, expansion: 'tbc' },  // Mana-Tombs
  { id: 251, expansion: 'tbc' },  // Old Hillsbrad Foothills
  { id: 252, expansion: 'tbc' },  // Sethekk Halls
  { id: 253, expansion: 'tbc' },  // Shadow Labyrinth
  { id: 254, expansion: 'tbc' },  // The Arcatraz
  { id: 255, expansion: 'tbc' },  // The Black Morass
  { id: 256, expansion: 'tbc' },  // The Blood Furnace
  { id: 257, expansion: 'tbc' },  // The Botanica
  { id: 258, expansion: 'tbc' },  // The Mechanar
  { id: 259, expansion: 'tbc' },  // The Shattered Halls
  { id: 260, expansion: 'tbc' },  // The Slave Pens
  { id: 261, expansion: 'tbc' },  // The Steamvault
  { id: 262, expansion: 'tbc' },  // The Underbog
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
