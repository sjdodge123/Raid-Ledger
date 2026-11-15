/**
 * ROK-2170: turn Wowhead "Forever" zone-page captures into `expansion: 'forever'`
 * rows in `src/plugins/wow-common/data/boss-loot-data.json`.
 *
 * The captures (`scripts/data/forever-boss-loot/zone-<id>-<slug>.json`) are read
 * by hand in a browser from a zone page's Drops tab — this script never touches
 * the network. A row is written only when a drop's source is a boss LISTED for
 * an instance the zone covers in `boss-encounter-data.json`; zone drops, trash
 * and unlisted rares are reported and skipped. Re-running is a no-op for rows
 * already there. ROK-2210: the zone resolves through the instance catalogue
 * (every wing of a shared zone); the planning lives in
 * `src/plugins/wow-common/forever-loot-import/forever-loot-plan.ts`.
 *
 * Usage (from `api/`):
 *   npx ts-node scripts/import-forever-boss-loot.ts <capture.json> [...more]   # dry run
 *   npx ts-node scripts/import-forever-boss-loot.ts --write <capture.json> [...more]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  planCapture,
  type BossRow,
  type Capture,
  type LootRow,
  type Plan,
} from '../src/plugins/wow-common/forever-loot-import/forever-loot-plan';

const DATA_DIR = resolve(__dirname, '../src/plugins/wow-common/data');
const LOOT_FILE = resolve(DATA_DIR, 'boss-loot-data.json');
const BOSS_FILE = resolve(DATA_DIR, 'boss-encounter-data.json');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
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

function run(args: readonly string[]): void {
  const write = args.includes('--write');
  const files = args.filter((a) => a !== '--write');
  if (files.length === 0) throw new Error('pass at least one capture file');

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

try {
  run(process.argv.slice(2));
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`import-forever-boss-loot: ${message}`);
  process.exit(1);
}
