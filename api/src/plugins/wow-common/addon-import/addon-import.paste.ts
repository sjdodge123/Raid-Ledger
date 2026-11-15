import {
  ADDON_IMPORT_MAX_TOKENS,
  ADDON_IMPORT_MAX_TOKENS_V2,
  ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS,
  type AddonExportSectionV2,
  type AddonExportVersion,
  type AddonWho,
} from '@raid-ledger/contract';
import { resolveExportName, sameName } from './addon-import.binding-name';
import { AddonImportError } from './addon-import.errors';
import {
  assertOneVersion,
  assertPageSet,
  parsePageHeader,
  type AddonPageHeader,
} from './addon-import.pages';

/**
 * Mixed-paste rules (ROK-1737 "Export all"): one paste may carry a char,
 * a guild and a raid export together, plus (v2, ROK-2184) one loot export.
 * One paste = one envelope version (ruling Q6). Headers are parsed and
 * grouped by section BEFORE anything is decoded.
 */

/** Canonical section order — results and fixtures list sections this way. */
export const ADDON_SECTION_ORDER: readonly AddonExportSectionV2[] = [
  'char',
  'guild',
  'raid',
  'loot',
];

/** User-facing section names (prefix a failing section's error message). */
export const ADDON_SECTION_LABEL: Record<AddonExportSectionV2, string> = {
  char: 'Character export',
  guild: 'Guild export',
  raid: 'Raid export',
  loot: 'Loot export',
};

/** Max tokens per paste: v1 8 guild pages + char + raid; v2 adds one loot. */
const MAX_TOKENS: Record<AddonExportVersion, number> = {
  1: ADDON_IMPORT_MAX_TOKENS,
  2: ADDON_IMPORT_MAX_TOKENS_V2,
};

/** One section's tokens: headers sorted by page, `bytes` = tokens joined by `\n`. */
export interface AddonSectionGroup {
  section: AddonExportSectionV2;
  headers: AddonPageHeader[];
  bytes: number;
}

const incomplete = (message: string) =>
  new AddonImportError('PAGES_INCOMPLETE', message);

function groupHeaders(group: AddonSectionGroup): AddonPageHeader[] {
  const { section, headers } = group;
  if (headers.length === 1) return assertPageSet(headers);
  if (section !== 'guild') {
    const name = ADDON_SECTION_LABEL[section].toLowerCase();
    throw incomplete(`That paste has more than one ${name} — paste it once.`);
  }
  if (headers.some((h) => h.page === null)) {
    throw incomplete('That paste has more than one guild export — paste one.');
  }
  return assertPageSet(headers);
}

/**
 * Split + parse + group a trimmed, non-empty paste. Guards, in order:
 * token count (≤ the v2 cap) → every header → one version per paste →
 * token count against that version's cap → per section: char/raid/loot at
 * most one token, guild through the unchanged page-set rules.
 * Returns the present sections in canonical order.
 */
export function parsePaste(input: string): AddonSectionGroup[] {
  const tokens = input.split(/\s+/);
  const tooMany = () => incomplete('That paste has too many pages.');
  if (tokens.length > ADDON_IMPORT_MAX_TOKENS_V2) throw tooMany();
  const parsed = tokens.map((token) => ({
    header: parsePageHeader(token),
    bytes: Buffer.byteLength(token, 'utf8'),
  }));
  const version = assertOneVersion(parsed.map((p) => p.header));
  if (tokens.length > MAX_TOKENS[version]) throw tooMany();
  return ADDON_SECTION_ORDER.flatMap((section) => {
    const mine = parsed.filter((p) => p.header.section === section);
    if (mine.length === 0) return [];
    const group: AddonSectionGroup = {
      section,
      headers: mine.map((p) => p.header),
      bytes: mine.reduce((sum, p) => sum + p.bytes, mine.length - 1),
    };
    return [{ ...group, headers: groupHeaders(group) }];
  });
}

interface ExporterStamp {
  client: { region: number };
  who: AddonWho;
  exportedAt: number;
}

/** Same GUID, same client region, same (realm-less) exporter name. */
function sameIdentity(a: ExporterStamp, b: ExporterStamp): boolean {
  return (
    a.who.guid === b.who.guid &&
    a.client.region === b.client.region &&
    sameName(resolveExportName(a.who), resolveExportName(b.who))
  );
}

/**
 * Every section of a mixed paste must come from the same character — the
 * same `who.guid`, `client.region` and realm-less exporter name, i.e. every
 * identity field the binding checks (Codex P2: a section must never land
 * under an identity only the first section proved) — and the same sitting
 * (`exportedAt` spread ≤ `ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS`).
 * A single section passes.
 */
export function assertSameExporter(payloads: ExporterStamp[]): void {
  const [first] = payloads;
  if (!first || payloads.length < 2) return;
  if (payloads.some((p) => !sameIdentity(first, p))) {
    throw new AddonImportError(
      'INVALID_PAYLOAD',
      'These strings come from different characters.',
    );
  }
  const times = payloads.map((p) => p.exportedAt);
  const spread = Math.max(...times) - Math.min(...times);
  if (spread > ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS) {
    throw new AddonImportError(
      'INVALID_PAYLOAD',
      'These strings come from different exports — use Export all and paste them together.',
    );
  }
}
