#!/usr/bin/env node
/**
 * ROK-2170: turn Wowhead "Forever" zone-page captures into `expansion: 'forever'`
 * rows in `src/plugins/wow-common/data/boss-loot-data.json`.
 *
 * The captures (`scripts/data/forever-boss-loot/zone-<id>-<slug>.json`) are read
 * by hand in a browser from a zone page's Drops tab — this script never touches
 * the network. A row is written only when a drop's source is a boss LISTED for
 * that instance in `boss-encounter-data.json`; zone drops, trash and unlisted
 * rares are reported and skipped. Re-running is a no-op for rows already there.
 *
 * Usage (from `api/`):
 *   node scripts/import-forever-boss-loot.mjs <capture.json> [...more]   # dry run
 *   node scripts/import-forever-boss-loot.mjs --write <capture.json> [...more]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../src/plugins/wow-common/data');
const LOOT_FILE = resolve(DATA_DIR, 'boss-loot-data.json');
const BOSS_FILE = resolve(DATA_DIR, 'boss-encounter-data.json');
const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/large';

/** Wowhead zone id → the instance id the bundled boss rows use. */
const ZONE_TO_INSTANCE = {
  717: 238, // The Stockade
  1581: 63, // The Deadmines
  209: 64, // Shadowfang Keep
  2437: 226, // Ragefire Chasm
  719: 227, // Blackfathom Deeps
  491: 234, // Razorfen Kraul
  722: 233, // Razorfen Downs
  1477: 237, // The Temple of Atal'Hakkar
  1583: 229, // Lower Blackrock Spire
  2057: 246, // Scholomance
};

/** Wowhead quality number (the q0..q5 link class) → the quality name. */
const QUALITY_NAMES = [
  'Poor',
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
];

/**
 * A Wowhead source that is a listed boss under another name. Sneed climbs
 * out of Sneed's Shredder and the boss list has one row for the encounter.
 */
const SOURCE_ALIASES = {
  Sneed: "Sneed's Shredder",
  // Spelling: Wowhead has a lower-case r, the bundled boss row does not.
  'Ghamoo-ra': 'Ghamoo-Ra',
};

/** Wowhead slot label → the slot vocabulary the loot file already uses. */
const SLOT_MAP = {
  Head: 'Head',
  Neck: 'Neck',
  Shoulder: 'Shoulder',
  Back: 'Back',
  Chest: 'Chest',
  Wrist: 'Wrist',
  Hands: 'Hands',
  Waist: 'Waist',
  Legs: 'Legs',
  Feet: 'Feet',
  Finger: 'Finger',
  Trinket: 'Trinket',
  'One-Hand': 'One-Hand',
  'Two-Hand': 'Two-Hand',
  'Main Hand': 'Main Hand',
  'Off Hand': 'Off Hand',
  'Held In Off-hand': 'Held In Off-hand',
  Shield: 'Shield',
  Ranged: 'Ranged',
  Thrown: 'Ranged',
  Relic: 'Relic',
  Ammo: null,
  Bag: null,
};

/** Wowhead type label → the itemSubclass vocabulary the loot file already uses. */
const TYPE_MAP = {
  'Cloth Armor': 'Cloth',
  'Leather Armor': 'Leather',
  'Mail Armor': 'Mail',
  'Plate Armor': 'Plate',
  Cloak: 'Cloth',
  Ring: 'Miscellaneous',
  Amulet: 'Miscellaneous',
  Trinket: 'Miscellaneous',
  'Off-hand Frill': 'Miscellaneous',
  Shield: 'Shield',
  Dagger: 'Dagger',
  'Fist Weapon': 'Fist Weapon',
  Staff: 'Staff',
  Polearm: 'Polearm',
  'One-Handed Axe': 'Axe',
  'One-Handed Mace': 'Mace',
  'One-Handed Sword': 'Sword',
  'Two-Handed Axe': 'Axe',
  'Two-Handed Mace': 'Mace',
  'Two-Handed Sword': 'Sword',
  Bow: 'Bow',
  Gun: 'Gun',
  Crossbow: 'Crossbow',
  Wand: 'Wand',
  'Thrown Weapon': 'Thrown',
  Bag: 'Bag',
  Quest: 'Quest',
  'Blacksmithing Plans': 'Blacksmithing',
  'Engineering Schematic': 'Engineering',
  'Leatherworking Pattern': 'Leatherworking',
  'Tailoring Pattern': 'Tailoring',
  'Enchanting Formula': 'Enchanting',
  Book: 'Book',
  Arrow: 'Arrow',
  'Cooking Recipe': 'Cooking',
  'First Aid Book': 'First Aid',
  'Fishing Book': 'Fishing',
};

function fail(message) {
  console.error(`import-forever-boss-loot: ${message}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function mapped(table, value, kind, drop) {
  if (value === null || value === undefined || value === '') return null;
  const out = table[value];
  if (out === undefined) {
    fail(`unknown ${kind} "${value}" on item ${drop.itemId} (${drop.name})`);
  }
  return out;
}

function toRow(bossName, drop) {
  if (!Number.isInteger(drop.itemId) || drop.itemId <= 0) {
    fail(
      `item ${JSON.stringify(drop.itemId)} on ${bossName} is not a positive integer id`,
    );
  }
  if (typeof drop.name !== 'string' || drop.name.trim() === '') {
    fail(`item ${drop.itemId} on ${bossName} has an empty name`);
  }
  const quality = QUALITY_NAMES[drop.quality];
  if (quality === undefined) {
    fail(`item ${drop.itemId} (${drop.name}) has no valid quality`);
  }
  if (!/^[a-z0-9_-]+$/.test(drop.icon ?? '')) {
    fail(`item ${drop.itemId} (${drop.name}) has no valid icon`);
  }
  return {
    bossName,
    expansion: 'forever',
    itemId: drop.itemId,
    itemName: drop.name,
    slot: mapped(SLOT_MAP, drop.slot, 'slot', drop),
    quality,
    itemLevel: drop.itemLevel ?? null,
    dropRate: null,
    classRestrictions: null,
    iconUrl: `${ICON_BASE}/${drop.icon}.jpg`,
    itemSubclass: mapped(TYPE_MAP, drop.type, 'type', drop),
  };
}

/** Rows + a report for one capture file. */
function planCapture(capture, bosses) {
  const instanceId = ZONE_TO_INSTANCE[capture.zoneId];
  if (!instanceId) fail(`no instance mapping for zone ${capture.zoneId}`);
  if (capture.drops.length !== capture.totalShown) {
    fail(
      `${capture.zone}: ${capture.drops.length} rows captured but the page showed ${capture.totalShown}`,
    );
  }
  const listed = bosses
    .filter((b) => b.instanceId === instanceId && b.expansion === 'classic')
    .map((b) => b.name);
  const rows = [];
  const skipped = [];
  for (const drop of capture.drops) {
    const sources = String(drop.source ?? '')
      .split('|')
      .map((s) => s.trim())
      .map((s) => SOURCE_ALIASES[s] ?? s);
    const hits = sources.filter((s) => listed.includes(s));
    if (hits.length === 0) skipped.push(drop);
    for (const boss of hits) rows.push(toRow(boss, drop));
  }
  return { zone: capture.zone, listed, rows, skipped };
}

function report(plan, added) {
  console.log(`\n== ${plan.zone} ==`);
  for (const boss of plan.listed) {
    const n = plan.rows.filter((r) => r.bossName === boss).length;
    console.log(`  ${String(n).padStart(2)}  ${boss}`);
  }
  for (const d of plan.skipped) {
    console.log(`  skipped ${d.itemId} ${d.name} (source: ${d.source})`);
  }
  console.log(`  new rows: ${added}`);
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const files = args.filter((a) => a !== '--write');
  if (files.length === 0) fail('pass at least one capture file');

  const loot = readJson(LOOT_FILE);
  const bosses = readJson(BOSS_FILE);
  const seen = new Set(
    loot.map((r) => `${r.bossName}::${r.expansion}::${r.itemId}`),
  );
  let total = 0;
  for (const file of files) {
    const plan = planCapture(readJson(resolve(file)), bosses);
    let added = 0;
    for (const row of plan.rows) {
      const key = `${row.bossName}::${row.expansion}::${row.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      loot.push(row);
      added += 1;
    }
    report(plan, added);
    total += added;
  }
  console.log(`\nTotal new rows: ${total}${write ? '' : ' (dry run)'}`);
  if (write && total > 0) {
    writeFileSync(LOOT_FILE, `${JSON.stringify(loot, null, 2)}\n`);
  }
}

main();
