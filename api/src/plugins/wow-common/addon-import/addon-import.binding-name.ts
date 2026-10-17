import type {
  AddonImportAddCharacterPrefill,
  AddonWho,
  WowRegion,
} from '@raid-ledger/contract';

/**
 * Pure name / class helpers for the ROK-1724 binding (§4.3 Binding table).
 * Split out of `addon-import.binding.ts` to keep both files small.
 */

/** `GetCurrentRegion()` → RL region. 5 (cn) is deliberately absent. */
export const ADDON_REGION_MAP: Readonly<Record<number, WowRegion>> = {
  1: 'us',
  2: 'kr',
  3: 'eu',
  4: 'tw',
};

/** Client class tokens that are more than one word. */
const MULTI_WORD_CLASSES: Readonly<Record<string, string>> = {
  DEATHKNIGHT: 'Death Knight',
  DEMONHUNTER: 'Demon Hunter',
};

/** `PALADIN` → `Paladin`, `DEATHKNIGHT` → `Death Knight`. */
export function titleCaseClass(token: string): string {
  const multi = MULTI_WORD_CLASSES[token];
  if (multi) return multi;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** NFC, collapse whitespace runs to one space, trim. */
export function normalizeName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Drop a trailing `-Realm` segment (WoW names never contain `-`). */
function stripRealm(name: string): string {
  const dash = name.indexOf('-');
  return dash === -1 ? name : name.slice(0, dash);
}

/**
 * The exporter's name: the first non-empty of `who.fullName`,
 * `raw.getUnitName`, `raw.unitFullName.join(' ')`; realm suffix stripped,
 * then normalised. Empty string when the payload carries no usable name.
 */
export function resolveExportName(who: AddonWho): string {
  const fullTuple = who.raw.unitFullName
    ?.filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ');
  const candidates = [who.fullName, who.raw.getUnitName, fullTuple];
  for (const candidate of candidates) {
    const name = normalizeName(stripRealm(candidate ?? ''));
    if (name !== '') return name;
  }
  return '';
}

/** Case-insensitive comparison of two already-normalised names. */
export function sameName(a: string, b: string): boolean {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

/** Add Character prefill for a `NAME_MISMATCH` (split on the first space). */
export function buildAddCharacterPrefill(
  who: AddonWho,
  exportName: string,
  region: WowRegion,
): AddonImportAddCharacterPrefill {
  const space = exportName.indexOf(' ');
  return {
    firstName: space === -1 ? exportName : exportName.slice(0, space),
    secondName: space === -1 ? '' : exportName.slice(space + 1),
    region,
    ruleset: who.ruleset,
    class: titleCaseClass(who.class),
  };
}
