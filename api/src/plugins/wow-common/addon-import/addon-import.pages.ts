import {
  ADDON_EXPORT_ACCEPTED_VERSIONS,
  ADDON_EXPORT_V2_PAYLOAD_SCHEMA,
  ADDON_IMPORT_MAX_PAGES,
  ADDON_IMPORT_PAGE_RE_V2,
  ADDON_PAGED_SECTIONS,
  AddonExportSectionV2Schema,
  AddonGuildExportSchema,
  AddonGuildExportV2Schema,
  isAddonExportVersion,
  isAddonSectionInVersion,
  type AddonExportSectionV2,
  type AddonExportVersion,
  type AddonGuildExport,
  type AddonGuildExportV2,
} from '@raid-ledger/contract';
import { AddonImportError } from './addon-import.errors';

/** A guild export from either envelope version (shapes differ only in `schema`). */
export type AnyAddonGuildExport = AddonGuildExport | AddonGuildExportV2;

/** One whitespace-separated token's parsed `!RL<v>!<section>[-<n>of<m>]!` header. */
export interface AddonPageHeader {
  /** Header version — 1 or 2 during the v1 → v2 transition (ROK-2184). */
  version: AddonExportVersion;
  section: AddonExportSectionV2;
  /** 1-based page number; null for an unpaged string. */
  page: number | null;
  /** Declared page count; null for an unpaged string. */
  of: number | null;
  /** Standard base64 body (alphabet already validated by the regex). */
  body: string;
}

const OLDEST_VERSION = Math.min(...ADDON_EXPORT_ACCEPTED_VERSIONS);

/** Too-new string. */
export const NEWER_VERSION_MESSAGE =
  'Raid Ledger needs an update to read this string.';
/** A payload `schema` that disagrees with its `!RLn!` header (ROK-2184). */
export const MISMATCHED_VERSION_MESSAGE =
  "This string's header and contents disagree on the addon version — export it again.";
/** Ruling Q6 — one paste = one envelope version. */
export const MIXED_VERSION_MESSAGE =
  'These strings come from different addon versions.';

function versionMessage(version: number): string {
  return version < OLDEST_VERSION
    ? 'Update the Raid Ledger addon, then export again.'
    : NEWER_VERSION_MESSAGE;
}

/** The section, if header `version` admits it (`!RL1!loot!…` → `BAD_HEADER`). */
function headerSection(
  version: AddonExportVersion,
  raw: string | undefined,
): AddonExportSectionV2 {
  const parsed = AddonExportSectionV2Schema.safeParse(raw);
  if (!parsed.success || !isAddonSectionInVersion(version, parsed.data)) {
    throw new AddonImportError('BAD_HEADER');
  }
  return parsed.data;
}

/**
 * Parse one token's header. Never echoes the token in an error. Order:
 * grammar → accepted version (`UNSUPPORTED_VERSION`) → section admitted by
 * that version → paging only for a paged section (`guild`), else `BAD_HEADER`.
 */
export function parsePageHeader(token: string): AddonPageHeader {
  const m = ADDON_IMPORT_PAGE_RE_V2.exec(token);
  const body = m?.[5];
  if (!m || body === undefined) throw new AddonImportError('BAD_HEADER');
  const version = Number(m[1]);
  if (!isAddonExportVersion(version)) {
    throw new AddonImportError('UNSUPPORTED_VERSION', versionMessage(version));
  }
  const section = headerSection(version, m[2]);
  if (m[3] === undefined)
    return { version, section, page: null, of: null, body };
  const page = Number(m[3]);
  const of = Number(m[4]);
  if (
    !ADDON_PAGED_SECTIONS.includes(section) ||
    of < 1 ||
    of > ADDON_IMPORT_MAX_PAGES ||
    page < 1 ||
    page > of
  ) {
    throw new AddonImportError('BAD_HEADER');
  }
  return { version, section, page, of, body };
}

/**
 * Ruling Q6 — every token of a paste carries the same header version; a
 * mixed `!RL1!` / `!RL2!` paste is rejected whole. Returns that version.
 */
export function assertOneVersion(
  headers: AddonPageHeader[],
): AddonExportVersion {
  const [first] = headers;
  if (!first) throw new AddonImportError('BAD_HEADER');
  if (headers.some((h) => h.version !== first.version)) {
    throw new AddonImportError('UNSUPPORTED_VERSION', MIXED_VERSION_MESSAGE);
  }
  return first.version;
}

const incomplete = (message?: string) =>
  new AddonImportError('PAGES_INCOMPLETE', message);

/**
 * Validate the page SET before anything is decoded: a single unpaged
 * string, or every page `1..M` of one guild export exactly once (any
 * paste order). Returns the headers sorted by page number.
 */
export function assertPageSet(headers: AddonPageHeader[]): AddonPageHeader[] {
  const [first] = headers;
  if (!first) throw new AddonImportError('BAD_HEADER');
  if (headers.length === 1 && first.page === null) return headers;
  if (headers.some((h) => h.page === null)) {
    throw incomplete('Paste one import string at a time.');
  }
  const of = first.of;
  if (headers.some((h) => h.of !== of)) throw incomplete();
  const seen = new Set(headers.map((h) => h.page));
  if (seen.size !== headers.length || headers.length !== of) throw incomplete();
  return [...headers].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
}

function samePageExport(
  a: AnyAddonGuildExport,
  b: AnyAddonGuildExport,
): boolean {
  return (
    a.schema === b.schema &&
    a.who.guid === b.who.guid &&
    a.exportedAt === b.exportedAt &&
    a.data.name === b.data.name &&
    a.data.snapshotAt === b.data.snapshotAt
  );
}

/** Re-validate a merged roster against its own version's schema. */
function revalidateGuild(
  candidate: AnyAddonGuildExport,
): AnyAddonGuildExport | null {
  const parsed =
    candidate.schema === ADDON_EXPORT_V2_PAYLOAD_SCHEMA
      ? AddonGuildExportV2Schema.safeParse(candidate)
      : AddonGuildExportSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Merge validated guild pages (already sorted) into one export: page 1's
 * envelope + every page's members in order. Pages must come from the same
 * snapshot; a member GUID may appear only once across all pages; the merged
 * roster is re-validated (≤ 2000 members).
 */
export function mergeGuildPages(
  pages: AnyAddonGuildExport[],
): AnyAddonGuildExport {
  const [first] = pages;
  if (!first) throw incomplete();
  if (pages.some((p) => !samePageExport(first, p))) {
    throw incomplete('These pages come from different guild exports.');
  }
  const members = pages.flatMap((p) => p.data.members);
  if (new Set(members.map((m) => m.guid)).size !== members.length) {
    throw new AddonImportError(
      'INVALID_PAYLOAD',
      'The guild roster lists a member twice.',
    );
  }
  const merged = revalidateGuild({
    ...first,
    data: { ...first.data, members },
  });
  if (!merged) {
    throw new AddonImportError(
      'INVALID_PAYLOAD',
      'The guild roster is too large.',
    );
  }
  return merged;
}
