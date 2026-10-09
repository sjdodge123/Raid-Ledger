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
  if (Array.isArray(value))
    return value.map((v: unknown) => sanitizeStrings(v)) as T;
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

/** Item link fields 1 (enchant) and 2-5 (gems); 0/empty = none. */
const ENCHANT_FIELD = 1;
const GEM_FIELDS = [2, 3, 4, 5] as const;

export interface ParsedItemLink {
  itemId: number | null;
  bonusIds: number[];
  /** Absent when the link carries no enchant. */
  enchantId?: number;
  /** Absent when the link carries no gem. */
  gemIds?: number[];
}

function parseBonusIds(fields: string[]): number[] {
  const count = toId(fields[BONUS_COUNT_FIELD]);
  if (count === null || count > MAX_BONUS_IDS) return [];
  const raw = fields.slice(
    BONUS_COUNT_FIELD + 1,
    BONUS_COUNT_FIELD + 1 + count,
  );
  const ids = raw.map(toId);
  if (ids.length !== count || ids.some((id) => id === null)) return [];
  return ids as number[];
}

function parseSockets(
  fields: string[],
): Omit<ParsedItemLink, 'itemId' | 'bonusIds'> {
  const enchantId = toId(fields[ENCHANT_FIELD]);
  const gemIds = GEM_FIELDS.map((i) => toId(fields[i])).filter(
    (id): id is number => id !== null,
  );
  return {
    ...(enchantId !== null ? { enchantId } : {}),
    ...(gemIds.length > 0 ? { gemIds } : {}),
  };
}

/**
 * Parse `|Hitem:itemID:enchant:gem1..4:suffix:unique:linkLevel:spec:
 * modifiersMask:context:numBonusIDs:bonus1…|h`. Anything malformed yields
 * `itemId: null` / `bonusIds: []` / no enchant or gems rather than throwing.
 */
export function parseItemLink(link: string): ParsedItemLink {
  const match = ITEM_LINK_RE.exec(link);
  if (!match) return { itemId: null, bonusIds: [] };
  const fields = (match[1] ?? '').split(':');
  return {
    itemId: toId(fields[0]),
    bonusIds: parseBonusIds(fields),
    ...parseSockets(fields),
  };
}

function toSnapshotGear(
  item: AddonCharData['gear'][number],
): AddonSnapshotGearItem {
  const parsed: ParsedItemLink = item.link
    ? parseItemLink(item.link)
    : { itemId: null, bonusIds: [] };
  const itemId = item.itemId ?? parsed.itemId ?? undefined;
  return {
    slot: item.slot,
    ...(itemId !== undefined ? { itemId } : {}),
    ...(item.ilvl !== undefined ? { ilvl: item.ilvl } : {}),
    bonusIds: parsed.bonusIds,
    ...(parsed.enchantId !== undefined ? { enchantId: parsed.enchantId } : {}),
    ...(parsed.gemIds ? { gemIds: parsed.gemIds } : {}),
  };
}

/**
 * Char `data` → the FROZEN `character_addon_snapshots.data` shape (schema
 * 2): gear links parsed to `bonusIds`/`enchantId`/`gemIds` and dropped,
 * `quests` and named talent nodes kept, every display string stripped.
 * Re-validated against the frozen schema so a drift fails loudly here.
 */
export function toCharSnapshotData(data: AddonCharData): AddonCharSnapshotData {
  const shaped = sanitizeStrings({
    gear: data.gear.map(toSnapshotGear),
    talents: data.talents,
    lockouts: data.lockouts,
    // Omitted when absent so schema-1-shaped exports stay byte-identical.
    ...(data.quests ? { quests: data.quests } : {}),
  });
  return AddonCharSnapshotDataSchema.parse(shaped);
}
