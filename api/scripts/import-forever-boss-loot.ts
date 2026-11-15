/**
 * ROK-2170: turn Wowhead "Forever" zone-page captures into `expansion: 'forever'`
 * rows in `src/plugins/wow-common/data/boss-loot-data.json`.
 *
 * The captures (`scripts/data/forever-boss-loot/zone-<id>-<slug>.json`) are read
 * by hand in a browser from a zone page's Drops tab — this script never touches
 * the network. A row is written only when a drop's source is a boss LISTED for
 * that instance in `boss-encounter-data.json`; zone drops, trash and unlisted
 * rares are reported and skipped. Re-running is a no-op for rows already there.
 * ROK-2210: the capture's Wowhead zone id resolves to an instance through the
 * instance catalogue (`byWowheadZoneId`), so this is TypeScript now.
 *
 * Usage (from `api/`):
 *   npx tsx scripts/import-forever-boss-loot.ts <capture.json> [...more]   # dry run
 *   npx tsx scripts/import-forever-boss-loot.ts --write <capture.json> [...more]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { byWowheadZoneId } from '../src/plugins/wow-common/instance-catalogue/instance-catalogue';

const DATA_DIR = resolve(__dirname, '../src/plugins/wow-common/data');
const LOOT_FILE = resolve(DATA_DIR, 'boss-loot-data.json');
const BOSS_FILE = resolve(DATA_DIR, 'boss-encounter-data.json');
const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/large';

interface CaptureDrop {
  itemId: number;
  name: string;
  quality: number;
  icon?: string;
  slot?: string | null;
  type?: string | null;
  itemLevel?: number | null;
  source?: string | null;
}

interface Capture {
  zone: string;
  zoneId: number;
  totalShown: number;
  drops: CaptureDrop[];
}

interface BossRow {
  name: string;
  instanceId: number;
  expansion: string;
}

interface LootRow {
  bossName: string;
  expansion: string;
  itemId: number;
  itemName: string;
  slot: string | null;
  quality: string;
  itemLevel: number | null;
  dropRate: null;
  classRestrictions: null;
  iconUrl: string;
  itemSubclass: string | null;
}

interface Plan {
  zone: string;
  listed: string[];
  rows: LootRow[];
  skipped: CaptureDrop[];
}

/** Wowhead quality number (the q0..q5 link class) → the quality name. */
const QUALITY_NAMES: readonly string[] = [
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
const SOURCE_ALIASES: Readonly<Record<string, string>> = {
  Sneed: "Sneed's Shredder",
  // Spelling: Wowhead has a lower-case r, the bundled boss row does not.
  'Ghamoo-ra': 'Ghamoo-Ra',
  // Gyth is Rend's mount; the boss list has one row for the encounter.
  Gyth: 'Warchief Rend Blackhand',
};

/**
 * Drops filed under exactly one boss whatever their Wowhead source says,
 * keyed by the capture's zone id. Operator ruling 2026-11-11: Wowhead's
 * Forever page does not attribute these to the Avatar of Hakkar.
 */
const ITEM_BOSS_OVERRIDES: Readonly<
  Record<number, Readonly<Record<number, string>>>
> = {
  1477: {
    10838: 'Avatar of Hakkar', // Might of Hakkar
    10844: 'Avatar of Hakkar', // Spire of Hakkar
    10845: 'Avatar of Hakkar', // Warrior's Embrace
    12462: 'Avatar of Hakkar', // Embrace of the Wind Serpent
  },
};

/** Wowhead slot label → the slot vocabulary the loot file already uses. */
const SLOT_MAP: Readonly<Record<string, string | null>> = {
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
const TYPE_MAP: Readonly<Record<string, string | null>> = {
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

function fail(message: string): never {
  console.error(`import-forever-boss-loot: ${message}`);
  process.exit(1);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function mapped(
  table: Readonly<Record<string, string | null>>,
  value: string | null | undefined,
  kind: string,
  drop: CaptureDrop,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const out = table[value];
  if (out === undefined) {
    fail(`unknown ${kind} "${value}" on item ${drop.itemId} (${drop.name})`);
  }
  return out;
}

function checkDrop(bossName: string, drop: CaptureDrop): string {
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
  return quality;
}

function toRow(bossName: string, drop: CaptureDrop): LootRow {
  const quality = checkDrop(bossName, drop);
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
    iconUrl: `${ICON_BASE}/${drop.icon ?? ''}.jpg`,
    itemSubclass: mapped(TYPE_MAP, drop.type, 'type', drop),
  };
}

/** The instance a capture's Wowhead zone belongs to (instance catalogue). */
function instanceFor(capture: Capture): number {
  const row = byWowheadZoneId(capture.zoneId, 'wow_forever');
  if (!row) fail(`no instance mapping for zone ${capture.zoneId}`);
  return row.id;
}

function checkCapture(capture: Capture): void {
  if (capture.drops.length !== capture.totalShown) {
    fail(
      `${capture.zone}: ${capture.drops.length} rows captured but the page showed ${capture.totalShown}`,
    );
  }
}

function overridesFor(
  capture: Capture,
  listed: string[],
): Readonly<Record<number, string>> {
  const overrides = ITEM_BOSS_OVERRIDES[capture.zoneId] ?? {};
  for (const boss of Object.values(overrides)) {
    if (!listed.includes(boss)) {
      fail(
        `${capture.zone}: override boss ${boss} is not listed for the instance`,
      );
    }
  }
  return overrides;
}

/** Bosses a drop's Wowhead source names, among the listed ones. */
function sourceBosses(drop: CaptureDrop, listed: string[]): string[] {
  return String(drop.source ?? '')
    .split('|')
    .map((s) => s.trim())
    .map((s) => SOURCE_ALIASES[s] ?? s)
    .filter((s) => listed.includes(s));
}

/** Rows + a report for one capture file. */
function planCapture(capture: Capture, bosses: BossRow[]): Plan {
  const instanceId = instanceFor(capture);
  checkCapture(capture);
  const listed = bosses
    .filter((b) => b.instanceId === instanceId && b.expansion === 'classic')
    .map((b) => b.name);
  const plan: Plan = { zone: capture.zone, listed, rows: [], skipped: [] };
  const overrides = overridesFor(capture, listed);
  const overridden = new Set<string>();
  for (const drop of capture.drops) {
    const override = overrides[drop.itemId];
    if (override) {
      overridden.add(String(drop.itemId));
      plan.rows.push(toRow(override, drop));
      continue;
    }
    const hits = sourceBosses(drop, listed);
    if (hits.length === 0) plan.skipped.push(drop);
    for (const boss of hits) plan.rows.push(toRow(boss, drop));
  }
  // A mistyped override id would otherwise do nothing, silently.
  for (const itemId of Object.keys(overrides)) {
    if (!overridden.has(itemId)) {
      fail(`${capture.zone}: override item ${itemId} is not in the capture`);
    }
  }
  return plan;
}

function report(plan: Plan, added: number): void {
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

const rowKey = (r: LootRow): string =>
  `${r.bossName}::${r.expansion}::${r.itemId}`;

/** Appends a plan's unseen rows to `loot`; returns how many were added. */
function applyPlan(plan: Plan, loot: LootRow[], seen: Set<string>): number {
  let added = 0;
  for (const row of plan.rows) {
    if (seen.has(rowKey(row))) continue;
    seen.add(rowKey(row));
    loot.push(row);
    added += 1;
  }
  return added;
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const files = args.filter((a) => a !== '--write');
  if (files.length === 0) fail('pass at least one capture file');

  const loot = readJson<LootRow[]>(LOOT_FILE);
  const bosses = readJson<BossRow[]>(BOSS_FILE);
  const seen = new Set(loot.map(rowKey));
  let total = 0;
  for (const file of files) {
    const plan = planCapture(readJson<Capture>(resolve(file)), bosses);
    const added = applyPlan(plan, loot, seen);
    report(plan, added);
    total += added;
  }
  console.log(`\nTotal new rows: ${total}${write ? '' : ' (dry run)'}`);
  if (write && total > 0) {
    writeFileSync(LOOT_FILE, `${JSON.stringify(loot, null, 2)}\n`);
  }
}

main();
