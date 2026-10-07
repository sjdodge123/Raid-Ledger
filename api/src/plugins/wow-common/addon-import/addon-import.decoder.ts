import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import {
  ADDON_IMPORT_MAX_BYTES,
  ADDON_IMPORT_MAX_DECODED_BYTES,
  AddonExportSchema,
  type AddonCharExport,
  type AddonCharSnapshotData,
  type AddonExport,
  type AddonExportSection,
  type AddonGuildExport,
  type AddonRaidExport,
} from '@raid-ledger/contract';
import { AddonImportError } from './addon-import.errors';
import { assertStructuralLimits } from './addon-import.limits';
import { mergeGuildPages, type AddonPageHeader } from './addon-import.pages';
import {
  ADDON_SECTION_LABEL,
  assertSameExporter,
  parsePaste,
  type AddonSectionGroup,
} from './addon-import.paste';
import { sanitizeStrings, toCharSnapshotData } from './addon-import.sanitize';

/** Char export with `data` already in the frozen snapshot shape. */
export type DecodedAddonCharExport = Omit<AddonCharExport, 'data'> & {
  data: AddonCharSnapshotData;
};
/** Validated + sanitised payload, discriminated by `section`. */
export type DecodedAddonExport =
  DecodedAddonCharExport | AddonGuildExport | AddonRaidExport;

/** One decoded section of a paste. */
export interface DecodedAddonSection<
  P extends DecodedAddonExport = DecodedAddonExport,
> {
  payload: P;
  /** Pages merged (1 for an unpaged string). */
  pages: number;
  /**
   * sha256 hex of THIS section's normalised tokens (pages sorted), computed
   * pre-decode — identical whether the section is pasted alone or mixed.
   */
  sha256: string;
  /**
   * UTF-8 bytes: the whole trimmed input for a single-section paste; in a
   * mixed paste, this section's tokens joined by `\n`.
   */
  inputBytes: number;
}

/** Single-section result (pre-ROK-1737 shape, unchanged). */
export type DecodedAddonImport = DecodedAddonSection;

export interface DecodedAddonSections {
  char?: DecodedAddonSection<DecodedAddonCharExport>;
  guild?: DecodedAddonSection<AddonGuildExport>;
  raid?: DecodedAddonSection<AddonRaidExport>;
}

/** A whole paste: 1–3 sections (ROK-1737 "Export all"). */
export interface DecodedAddonPaste {
  sections: DecodedAddonSections;
  /** Present sections in canonical order char → guild → raid. */
  order: AddonExportSection[];
  /** Whitespace-separated tokens in the paste. */
  tokens: number;
  /** UTF-8 byte length of the whole trimmed input. */
  inputBytes: number;
}

const SAFE_KEY = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

/** First Zod issue → message with its PATH only; values are never echoed. */
function describeIssue(issue?: {
  code: string;
  path: ReadonlyArray<PropertyKey>;
}): string {
  const path = (issue?.path ?? [])
    .map((seg) =>
      typeof seg === 'number'
        ? `[${seg}]`
        : typeof seg === 'string' && SAFE_KEY.test(seg)
          ? `.${seg}`
          : '.?',
    )
    .join('')
    .replace(/^\./, '');
  const what =
    issue?.code === 'unrecognized_keys'
      ? 'an unexpected field'
      : 'an invalid value';
  return `The import string has ${what}${path ? ` at ${path}` : ''}.`;
}

function isOutputTooLarge(err: unknown): boolean {
  return (
    err instanceof RangeError ||
    (err as { code?: unknown })?.code === 'ERR_BUFFER_TOO_LARGE'
  );
}

/**
 * Inflate one page. `maxOutputLength` makes zlib abort DURING inflation
 * once the cap is passed, so a zip bomb never allocates its full output.
 */
function inflatePage(body: string): Buffer {
  if (body.length % 4 !== 0) throw new AddonImportError('CUT_OFF');
  const compressed = Buffer.from(body, 'base64');
  try {
    return inflateSync(compressed, {
      maxOutputLength: ADDON_IMPORT_MAX_DECODED_BYTES,
    });
  } catch (err) {
    throw new AddonImportError(
      isOutputTooLarge(err) ? 'DECODED_TOO_LARGE' : 'CUT_OFF',
    );
  }
}

function decodePage(header: AddonPageHeader): AddonExport {
  let json: unknown;
  try {
    json = JSON.parse(inflatePage(header.body).toString('utf8'));
  } catch (err) {
    if (err instanceof AddonImportError) throw err;
    throw new AddonImportError('CUT_OFF');
  }
  assertStructuralLimits(json);
  const parsed = AddonExportSchema.safeParse(json);
  if (!parsed.success) {
    throw new AddonImportError(
      'INVALID_PAYLOAD',
      describeIssue(parsed.error.issues[0]),
    );
  }
  if (parsed.data.section !== header.section) {
    throw new AddonImportError(
      'INVALID_PAYLOAD',
      "The string's header and contents disagree.",
    );
  }
  return parsed.data;
}

/** Sanitise exactly once (stripping is not idempotent: `||c…` → `|c…`). */
function finalize(pages: AddonExport[]): DecodedAddonExport {
  const [first] = pages;
  if (!first) throw new AddonImportError('BAD_HEADER');
  if (first.section === 'guild') {
    return sanitizeStrings(mergeGuildPages(pages as AddonGuildExport[]));
  }
  if (first.section === 'raid') return sanitizeStrings(first);
  const { data, ...envelope } = first;
  return { ...sanitizeStrings(envelope), data: toCharSnapshotData(data) };
}

function normalisedHash(headers: AddonPageHeader[]): string {
  const canonical = headers
    .map((h) => `${h.section}:${h.page ?? 0}/${h.of ?? 0}:${h.body}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Decode one section group; in a mixed paste, errors name the section. */
function decodeGroup(
  group: AddonSectionGroup,
  inputBytes: number,
  mixed: boolean,
): DecodedAddonSection {
  const sha256 = normalisedHash(group.headers);
  try {
    const payload = finalize(group.headers.map(decodePage));
    return { payload, pages: group.headers.length, sha256, inputBytes };
  } catch (err) {
    if (!mixed || !(err instanceof AddonImportError)) throw err;
    const label = ADDON_SECTION_LABEL[group.section];
    throw new AddonImportError(err.code, `${label}: ${err.body.message}`);
  }
}

function toSections(decoded: DecodedAddonSection[]): DecodedAddonSections {
  const sections: Partial<Record<AddonExportSection, DecodedAddonSection>> = {};
  for (const d of decoded) sections[d.payload.section] = d;
  return sections as DecodedAddonSections;
}

/**
 * Decode a paste of one or more `!RL1!<section>[-<n>of<m>]!<base64(zlib(json))>`
 * tokens — one char, one guild export (unpaged or every page once) and one
 * raid, any order (ROK-1737). Order of guards, each before the next
 * allocates anything: input bytes → token count → headers + grouping +
 * page set → per section, per page: base64 length → bounded inflate → JSON
 * → structural limits → strict schema → same exporter across sections.
 * All-or-nothing: any failure rejects the whole paste. Throws
 * `AddonImportError`; never echoes input.
 */
export function decodeImportPaste(raw: string): DecodedAddonPaste {
  const input = raw.trim();
  const inputBytes = Buffer.byteLength(input, 'utf8');
  if (inputBytes > ADDON_IMPORT_MAX_BYTES)
    throw new AddonImportError('TOO_LARGE');
  if (input === '') throw new AddonImportError('BAD_HEADER');
  const groups = parsePaste(input);
  const mixed = groups.length > 1;
  const decoded = groups.map((g) =>
    decodeGroup(g, mixed ? g.bytes : inputBytes, mixed),
  );
  assertSameExporter(decoded.map((d) => d.payload));
  return {
    sections: toSections(decoded),
    order: groups.map((g) => g.section),
    tokens: groups.reduce((n, g) => n + g.headers.length, 0),
    inputBytes,
  };
}

/**
 * Single-section compatibility path (the ROK-1724 import service): decode
 * the paste, then require exactly one section. A mixed paste is rejected
 * with `PAGES_INCOMPLETE` until the service handles several sections.
 */
export function decodeImportString(raw: string): DecodedAddonImport {
  const { sections, order } = decodeImportPaste(raw);
  const [only] = order;
  const section = only && order.length === 1 ? sections[only] : undefined;
  if (!section) {
    throw new AddonImportError(
      'PAGES_INCOMPLETE',
      'Paste one import string at a time.',
    );
  }
  return section;
}
