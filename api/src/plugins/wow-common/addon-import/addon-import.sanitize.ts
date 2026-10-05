import {
  AddonCharSnapshotDataSchema,
  type AddonCharData,
  type AddonCharSnapshotData,
  type AddonSnapshotGearItem,
} from '@raid-ledger/contract';

/**
 * WoW UI escape sequences, matched left-to-right in ONE pass so `||` (a
 * literal pipe) is consumed before it can start another escape:
 * `||` · `|cAARRGGBB` · `|cn<COLOR>:` · `|r` · `|H…|h` · `|h` · `|T…|t` ·
 * `|A…|a` · `|K…|k` · `|n`. Every branch is linear — no nested quantifiers.
 */
const ESCAPE_RE =
  /\|\||\|c[0-9a-fA-F]{8}|\|cn[^:|]{0,64}:|\|r|\|H[^|]*\|h|\|h|\|T[^|]*\|t|\|A[^|]*\|a|\|K[^|]*\|k|\|n/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

/** Strip colour/link/texture escapes and control characters from a display string. */
export function stripEscapes(value: string): string {
  return value
    .replace(ESCAPE_RE, (m) => (m === '||' ? '|' : m === '|n' ? ' ' : ''))
    .replace(CONTROL_RE, ' ');
}

/** Deep-copy `value`, stripping escapes from every string (keys untouched). */
export function sanitizeStrings<T>(value: T): T {
  if (typeof value === 'string') return stripEscapes(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => sanitizeStrings(v)) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitizeStrings(v);
  return out as T;
}

const INT4_MAX = 2_147_483_647;
const MAX_BONUS_IDS = 32;
/** Field 12 of an item link payload is `numBonusIDs`; the ids follow it. */
const BONUS_COUNT_FIELD = 12;
const ITEM_LINK_RE = /(?:^|\|H)item:([-0-9:]{0,400})/;

function toId(field: string | undefined): number | null {
  if (!field || !/^\d{1,10}$/.test(field)) return null;
  const n = Number(field);
  return n > 0 && n <= INT4_MAX ? n : null;
}

/**
 * Parse `|Hitem:itemID:enchant:gem1..4:suffix:unique:linkLevel:spec:
 * modifiersMask:context:numBonusIDs:bonus1…|h`. Anything malformed yields
 * `itemId: null` / `bonusIds: []` rather than throwing.
 */
export function parseItemLink(link: string): { itemId: number | null; bonusIds: number[] } {
  const match = ITEM_LINK_RE.exec(link);
  if (!match) return { itemId: null, bonusIds: [] };
  const fields = match[1].split(':');
  const itemId = toId(fields[0]);
  const count = toId(fields[BONUS_COUNT_FIELD]);
  if (count === null || count > MAX_BONUS_IDS) return { itemId, bonusIds: [] };
  const raw = fields.slice(BONUS_COUNT_FIELD + 1, BONUS_COUNT_FIELD + 1 + count);
  const ids = raw.map(toId);
  if (ids.length !== count || ids.some((id) => id === null)) {
    return { itemId, bonusIds: [] };
  }
  return { itemId, bonusIds: ids as number[] };
}

function toSnapshotGear(item: AddonCharData['gear'][number]): AddonSnapshotGearItem {
  const parsed = item.link ? parseItemLink(item.link) : { itemId: null, bonusIds: [] };
  const itemId = item.itemId ?? parsed.itemId ?? undefined;
  return {
    slot: item.slot,
    ...(itemId !== undefined ? { itemId } : {}),
    ...(item.ilvl !== undefined ? { ilvl: item.ilvl } : {}),
    bonusIds: parsed.bonusIds,
  };
}

/**
 * Char `data` → the FROZEN `character_addon_snapshots.data` shape: gear
 * links parsed to `bonusIds` and dropped, every display string stripped.
 * Re-validated against the frozen schema so a drift fails loudly here.
 */
export function toCharSnapshotData(data: AddonCharData): AddonCharSnapshotData {
  const shaped = sanitizeStrings({
    gear: data.gear.map(toSnapshotGear),
    talents: data.talents,
    lockouts: data.lockouts,
  });
  return AddonCharSnapshotDataSchema.parse(shaped);
}
