/**
 * ROK-1889 — the Map tab's chest focus. No stable chest id exists (ZDO ids
 * change every world load), so a chest is named by prefab + position (0.1 m),
 * never by a row id: an id in a URL would leak how many hidden personal
 * chests exist. The response is an explicit field list — no key, row id or
 * `creatorPlayerId` ever leaves.
 */
import { BadRequestException } from '@nestjs/common';
import type { ValheimContainerPrivacyRow } from '../../../../drizzle/schema';
import {
  parsePrefabFilter,
  toCount,
  toVisibility,
} from './valheim-materials.mappers';

/** Valheim worlds are ~10 km across; anything past this is malformed. */
export const COORD_LIMIT = 100_000;
/** Positions are stored rounded to 0.1 m: within this they are one spot. */
export const COORD_TOLERANCE = 0.06;

const COORD_RE = /^-?\d{1,6}(\.\d{1,3})?$/;

export interface ChestFocusQuery {
  prefab: string;
  x: number;
  z: number;
  /** Only to tell stacked chests apart; null → the lowest one. */
  y: number | null;
  /** The filtered item ("Iron ×12"), or null. */
  item: string | null;
}

export type { ValheimChestFocus } from '@raid-ledger/contract';
import type { ValheimChestFocus } from '@raid-ledger/contract';

/** The repository row (`held` is a bigint sum, or null without `item`). */
export interface ChestFocusRow {
  prefab: string;
  x: number;
  y: number;
  z: number;
  privacy: ValheimContainerPrivacyRow;
  vehicle: boolean;
  slots: number;
  usedSlots: number;
  held: string | number | null;
}

function parseCoord(raw: unknown, name: string): number {
  if (typeof raw !== 'string' || !COORD_RE.test(raw))
    throw new BadRequestException(`Invalid ${name}`);
  const n = Number(raw);
  if (Math.abs(n) > COORD_LIMIT)
    throw new BadRequestException(`Invalid ${name}`);
  return n;
}

/** `?prefab=&x=&z=[&y=][&item=]` → the query, else 400. */
export function parseChestFocusQuery(
  q: Readonly<Record<string, unknown>>,
): ChestFocusQuery {
  const prefab = parsePrefabFilter(q.prefab);
  if (prefab === null) throw new BadRequestException('Invalid prefab');
  return {
    prefab,
    x: parseCoord(q.x, 'x'),
    z: parseCoord(q.z, 'z'),
    y: q.y === undefined ? null : parseCoord(q.y, 'y'),
    item: parsePrefabFilter(q.item),
  };
}

/** Explicit field list: an extra selected column can never leak. */
export function toChestFocus(
  row: ChestFocusRow,
  item: string | null,
): ValheimChestFocus {
  return {
    prefab: row.prefab,
    x: row.x,
    y: row.y,
    z: row.z,
    privacy: toVisibility(row.privacy),
    vehicle: row.vehicle,
    slots: row.slots,
    usedSlots: row.usedSlots,
    held:
      item === null ? null : { prefab: item, count: toCount(row.held ?? 0) },
  };
}
