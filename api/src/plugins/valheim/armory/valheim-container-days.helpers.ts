/**
 * ROK-2014 — pure helpers for the containers' per-play-day snapshot (D2, D3,
 * D6, D8, D9). One row per prefab × segment (`vehicle`, `owner`) per day, and
 * the same per base. `owner` is `''` for a shared chest (privacy not
 * `private`), else the private chest's `creatorPlayerId` — never served.
 */
import type {
  ValheimContainer,
  ValheimContainersMessage,
} from '@raid-ledger/contract';
import {
  assignBases,
  clusterBases,
  type BasePoint,
} from './read/valheim-base-clusters.helpers';
import { containerPublicKey } from './valheim-container-key';

/** Calendar days of container history kept per server (operator ruling). */
export const CONTAINER_DAYS_RETAINED = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One server-day × prefab × segment end-of-day total. */
export interface DayItemTotal {
  prefab: string;
  vehicle: boolean;
  owner: string;
  total: number;
}

/** The same, within one base (rounded centroid for OPEN-1's fallback). */
export interface DayBaseItemTotal extends DayItemTotal {
  baseKey: string;
  baseX: number;
  baseZ: number;
}

/** D3: `''` = shared; a private chest's segment is its builder's player id. */
export function segmentOwner(
  c: Pick<ValheimContainer, 'privacy' | 'creatorPlayerId'>,
): string {
  return c.privacy === 'private' ? c.creatorPlayerId : '';
}

/** The item table's natural key (`valheim_container_item_days_key_uq` minus day). */
export function itemSegKey(r: Omit<DayItemTotal, 'total'>): string {
  return JSON.stringify([r.prefab, r.vehicle, r.owner]);
}

/** The base table's natural key (`valheim_container_base_item_days_key_uq` minus day). */
export function baseSegKey(
  r: Pick<DayBaseItemTotal, 'baseKey' | 'prefab' | 'vehicle' | 'owner'>,
): string {
  return JSON.stringify([r.baseKey, r.prefab, r.vehicle, r.owner]);
}

/** Merge `row` into the row stored at `key` (summing totals). */
function addTo<T extends DayItemTotal>(
  out: Map<string, T>,
  key: string,
  row: T,
): void {
  const have = out.get(key);
  if (have) have.total += row.total;
  else out.set(key, row);
}

/** D2: Σ stack over every chest by (prefab, vehicle, owner); qualities summed. */
export function dayItemTotals(
  msg: ValheimContainersMessage,
): Map<string, DayItemTotal> {
  const out = new Map<string, DayItemTotal>();
  for (const c of msg.containers) {
    const owner = segmentOwner(c);
    for (const s of c.items) {
      const row = { prefab: s.prefab, vehicle: c.vehicle, owner };
      addTo(out, itemSegKey(row), { ...row, total: s.stack });
    }
  }
  return dropEmpty(out);
}

/** D9: the scan's bases, exactly as every viewer's read builds them. */
function basesOf(msg: ValheimContainersMessage) {
  const points: BasePoint[] = msg.containers.map((c) => ({
    key: containerPublicKey(msg.worldUid, c),
    x: c.x,
    z: c.z,
    vehicle: c.vehicle,
    shared: c.privacy !== 'private',
  }));
  const bases = clusterBases(points);
  return {
    assign: assignBases(points, bases),
    centre: new Map(bases.map((b) => [b.key, { x: b.x, z: b.z }])),
  };
}

/** D9: per-base totals; a chest attached to no base contributes nothing. */
export function dayBaseTotals(
  msg: ValheimContainersMessage,
): Map<string, DayBaseItemTotal> {
  const { assign, centre } = basesOf(msg);
  const out = new Map<string, DayBaseItemTotal>();
  for (const c of msg.containers) {
    const baseKey = assign.get(containerPublicKey(msg.worldUid, c)) ?? null;
    const at = baseKey === null ? undefined : centre.get(baseKey);
    if (baseKey === null || !at) continue;
    const owner = segmentOwner(c);
    for (const s of c.items) {
      const row = { baseKey, baseX: at.x, baseZ: at.z, prefab: s.prefab };
      const seg = { ...row, vehicle: c.vehicle, owner, total: s.stack };
      addTo(out, baseSegKey(seg), seg);
    }
  }
  return dropEmpty(out);
}

/** The CHECK (total > 0) rejects zero rows — absent already means 0 (D1). */
function dropEmpty<T extends DayItemTotal>(m: Map<string, T>): Map<string, T> {
  for (const [k, r] of m) if (r.total <= 0) m.delete(k);
  return m;
}

/** D6 result: rows to upsert (new or changed) and stored ids now absent. */
export interface DayDiff<T> {
  upserts: T[];
  deleteIds: number[];
}

/**
 * D6: compare a day's stored rows with the desired end-of-day set. An
 * unchanged row (per `same`, total by default) is not written.
 */
export function diffDay<T extends DayItemTotal>(
  existing: readonly (T & { id: number })[],
  desired: ReadonlyMap<string, T>,
  keyOf: (r: T) => string,
  same: (a: T, b: T) => boolean = (a, b) => a.total === b.total,
): DayDiff<T> {
  const stored = new Map(existing.map((r) => [keyOf(r), r]));
  const upserts = [...desired].flatMap(([k, want]) => {
    const have = stored.get(k);
    return have && same(have, want) ? [] : [want];
  });
  const deleteIds = existing
    .filter((r) => !desired.has(keyOf(r)))
    .map((r) => r.id);
  return { upserts, deleteIds };
}

/** Base rows also move when the centroid shifts (OPEN-1 matches on it). */
export const sameBaseRow = (a: DayBaseItemTotal, b: DayBaseItemTotal) =>
  a.total === b.total && a.baseX === b.baseX && a.baseZ === b.baseZ;

/** D8: the newest play date the retention delete removes (`<=`). */
export function retentionCutoff(playDate: string): string {
  const at = Date.parse(`${playDate}T00:00:00Z`);
  return new Date(at - CONTAINER_DAYS_RETAINED * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
