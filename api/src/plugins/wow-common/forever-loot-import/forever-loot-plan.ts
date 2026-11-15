/**
 * ROK-2170 / ROK-2210: plan `expansion: 'forever'` loot rows from one Wowhead
 * Forever zone-page capture. A row is planned only when a drop's source is a
 * boss LISTED for an instance the capture's zone covers; a shared zone (Dire
 * Maul 2557, Stratholme 2017) covers every wing. Pure — the CLI in
 * `api/scripts/import-forever-boss-loot.ts` does the file I/O.
 */
import { allByWowheadZoneId } from '../instance-catalogue/instance-catalogue';
import {
  ITEM_BOSS_OVERRIDES,
  QUALITY_NAMES,
  SLOT_MAP,
  SOURCE_ALIASES,
  TYPE_MAP,
} from './forever-loot-plan.maps';

const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/large';

export interface CaptureDrop {
  itemId: number;
  name: string;
  quality: number;
  icon?: string;
  slot?: string | null;
  type?: string | null;
  itemLevel?: number | null;
  source?: string | null;
}

export interface Capture {
  zone: string;
  zoneId: number;
  totalShown: number;
  drops: CaptureDrop[];
}

export interface BossRow {
  name: string;
  instanceId: number;
  expansion: string;
}

export interface LootRow {
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

export interface Plan {
  zone: string;
  listed: string[];
  rows: LootRow[];
  skipped: CaptureDrop[];
}

function fail(message: string): never {
  throw new Error(message);
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

/** Every instance (parent and wings) a capture's Wowhead zone covers. */
function instanceIdsFor(capture: Capture): ReadonlySet<number> {
  const rows = allByWowheadZoneId(capture.zoneId, 'wow_forever');
  if (rows.length === 0) fail(`no instance mapping for zone ${capture.zoneId}`);
  return new Set(rows.map((r) => r.id));
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

/** Classic boss names listed for any instance the capture's zone covers. */
function listedBosses(capture: Capture, bosses: readonly BossRow[]): string[] {
  const ids = instanceIdsFor(capture);
  return bosses
    .filter((b) => ids.has(b.instanceId) && b.expansion === 'classic')
    .map((b) => b.name);
}

/** Rows + a report for one capture; throws on a malformed capture. */
export function planCapture(
  capture: Capture,
  bosses: readonly BossRow[],
): Plan {
  const listed = listedBosses(capture, bosses);
  checkCapture(capture);
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
