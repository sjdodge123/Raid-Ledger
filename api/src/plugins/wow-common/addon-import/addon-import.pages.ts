import {
  ADDON_EXPORT_ENVELOPE_VERSION,
  ADDON_IMPORT_MAX_PAGES,
  ADDON_IMPORT_PAGE_RE,
  AddonGuildExportSchema,
  type AddonExportSection,
  type AddonGuildExport,
} from '@raid-ledger/contract';
import { AddonImportError } from './addon-import.errors';

/** One whitespace-separated token's parsed `!RL<v>!<section>[-<n>of<m>]!` header. */
export interface AddonPageHeader {
  section: AddonExportSection;
  /** 1-based page number; null for an unpaged string. */
  page: number | null;
  /** Declared page count; null for an unpaged string. */
  of: number | null;
  /** Standard base64 body (alphabet already validated by the regex). */
  body: string;
}

function versionMessage(version: number): string {
  return version < ADDON_EXPORT_ENVELOPE_VERSION
    ? 'Update the Raid Ledger addon, then export again.'
    : 'Raid Ledger needs an update to read this string.';
}

/** Parse one token's header. Never echoes the token in an error. */
export function parsePageHeader(token: string): AddonPageHeader {
  const m = ADDON_IMPORT_PAGE_RE.exec(token);
  if (!m) throw new AddonImportError('BAD_HEADER');
  const version = Number(m[1]);
  if (version !== ADDON_EXPORT_ENVELOPE_VERSION) {
    throw new AddonImportError('UNSUPPORTED_VERSION', versionMessage(version));
  }
  const section = m[2] as AddonExportSection;
  if (m[3] === undefined) return { section, page: null, of: null, body: m[5] };
  const page = Number(m[3]);
  const of = Number(m[4]);
  if (section !== 'guild' || of < 1 || of > ADDON_IMPORT_MAX_PAGES || page < 1 || page > of) {
    throw new AddonImportError('BAD_HEADER');
  }
  return { section, page, of, body: m[5] };
}

const incomplete = (message?: string) => new AddonImportError('PAGES_INCOMPLETE', message);

/**
 * Validate the page SET before anything is decoded: a single unpaged
 * string, or every page `1..M` of one guild export exactly once (any
 * paste order). Returns the headers sorted by page number.
 */
export function assertPageSet(headers: AddonPageHeader[]): AddonPageHeader[] {
  if (headers.length === 1 && headers[0].page === null) return headers;
  if (headers.some((h) => h.page === null)) {
    throw incomplete('Paste one import string at a time.');
  }
  const of = headers[0].of;
  if (headers.some((h) => h.of !== of)) throw incomplete();
  const seen = new Set(headers.map((h) => h.page));
  if (seen.size !== headers.length || headers.length !== of) throw incomplete();
  return [...headers].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
}

function samePageExport(a: AddonGuildExport, b: AddonGuildExport): boolean {
  return (
    a.who.guid === b.who.guid &&
    a.exportedAt === b.exportedAt &&
    a.data.name === b.data.name &&
    a.data.snapshotAt === b.data.snapshotAt
  );
}

/**
 * Merge validated guild pages (already sorted) into one export: page 1's
 * envelope + every page's members in order. Pages must come from the same
 * snapshot; a member GUID may appear only once across all pages; the merged
 * roster is re-validated (≤ 2000 members).
 */
export function mergeGuildPages(pages: AddonGuildExport[]): AddonGuildExport {
  const [first] = pages;
  if (pages.some((p) => !samePageExport(first, p))) {
    throw incomplete('These pages come from different guild exports.');
  }
  const members = pages.flatMap((p) => p.data.members);
  if (new Set(members.map((m) => m.guid)).size !== members.length) {
    throw new AddonImportError('INVALID_PAYLOAD', 'The guild roster lists a member twice.');
  }
  const merged = AddonGuildExportSchema.safeParse({
    ...first,
    data: { ...first.data, members },
  });
  if (!merged.success) {
    throw new AddonImportError('INVALID_PAYLOAD', 'The guild roster is too large.');
  }
  return merged.data;
}
