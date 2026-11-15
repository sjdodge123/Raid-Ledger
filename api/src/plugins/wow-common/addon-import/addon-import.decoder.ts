import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import {
  ADDON_IMPORT_MAX_BYTES,
  ADDON_IMPORT_MAX_DECODED_BYTES,
  ADDON_EXPORT_V2_ENVELOPE_VERSION,
  AddonExportSchema,
  AddonExportV2Schema,
  type AddonCharExport,
  type AddonCharExportV2,
  type AddonCharSnapshotData,
  type AddonExport,
  type AddonExportSectionV2,
  type AddonExportV2,
  type AddonExportVersion,
  type AddonInstalledList,
  type AddonLootExport,
  type AddonMailworthy,
  type AddonRaidExport,
  type AddonRaidExportV2,
} from '@raid-ledger/contract';
import { dedupeInstalled } from './addon-import-char.installed.helpers';
import { assertPlausibleExportTimes, exportClock } from './addon-import.clock';
import { AddonImportError } from './addon-import.errors';
import { assertStructuralLimits } from './addon-import.limits';
import {
  mergeGuildPages,
  MISMATCHED_VERSION_MESSAGE,
  type AddonPageHeader,
  type AnyAddonGuildExport,
} from './addon-import.pages';
import {
  ADDON_SECTION_LABEL,
  assertSameExporter,
  parsePaste,
  type AddonSectionGroup,
} from './addon-import.paste';
import {
  sanitizeGuildExport,
  sanitizeLootExport,
  sanitizeStrings,
  toCharSnapshotData,
} from './addon-import.sanitize';

/** One page's validated body, from either envelope version (ROK-2184). */
type AnyAddonExport = AddonExport | AddonExportV2;

/** Char export (v1 or v2) with `data` already in the frozen snapshot shape. */
export type DecodedAddonCharExport = Omit<
  AddonCharExport | AddonCharExportV2,
  'data'
> & {
  data: AddonCharSnapshotData;
  /**
   * `data.mailworthy` lifted beside the frozen snapshot `data` (ROK-2148):
   * guild-level contributions data, never stored in the char snapshot.
   */
  mailworthy?: AddonMailworthy;
  /** `data.addons` lifted the same way (ROK-2147): never in the snapshot. */
  addons?: AddonInstalledList;
};
/** A raid export from either envelope version. */
export type DecodedAddonRaidExport = AddonRaidExport | AddonRaidExportV2;
/**
 * Validated + sanitised payload, discriminated by `section`; `schema` keeps
 * the envelope version (1 or 2). `loot` only ever comes from a v2 string.
 */
export type DecodedAddonExport =
  | DecodedAddonCharExport
  | AnyAddonGuildExport
  | DecodedAddonRaidExport
  | AddonLootExport;

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
  guild?: DecodedAddonSection<AnyAddonGuildExport>;
  raid?: DecodedAddonSection<DecodedAddonRaidExport>;
  loot?: DecodedAddonSection<AddonLootExport>;
}

/** A whole paste: 1–4 sections (ROK-1737 "Export all"; v2 adds loot). */
export interface DecodedAddonPaste {
  sections: DecodedAddonSections;
  /** Present sections in canonical order char → guild → raid → loot. */
  order: AddonExportSectionV2[];
  /** Whitespace-separated tokens in the paste. */
  tokens: number;
  /** UTF-8 byte length of the whole trimmed input. */
  inputBytes: number;
  /** ROK-2184 — the paste's one `!RLn!` envelope version (ruling Q6). */
  version: AddonExportVersion;
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

/**
 * ROK-2184 — a v2 header around a body whose `schema` is not 2 is a version
 * mismatch, not a bad payload (keeps `!RL2!` + `schema: 1` at its v1 code).
 * A v1 header keeps its v1 behaviour: the strict schema rejects it.
 */
function assertPayloadVersion(
  json: unknown,
  version: AddonExportVersion,
): void {
  if (version !== ADDON_EXPORT_V2_ENVELOPE_VERSION) return;
  const declared =
    typeof json === 'object' && json !== null && 'schema' in json
      ? json.schema
      : undefined;
  if (typeof declared === 'number' && declared !== version) {
    throw new AddonImportError(
      'UNSUPPORTED_VERSION',
      MISMATCHED_VERSION_MESSAGE,
    );
  }
}

/** The strict schema of the header's version. */
function parseVersioned(json: unknown, version: AddonExportVersion) {
  return version === ADDON_EXPORT_V2_ENVELOPE_VERSION
    ? AddonExportV2Schema.safeParse(json)
    : AddonExportSchema.safeParse(json);
}

function decodePage(header: AddonPageHeader): AnyAddonExport {
  let json: unknown;
  try {
    json = JSON.parse(inflatePage(header.body).toString('utf8'));
  } catch (err) {
    if (err instanceof AddonImportError) throw err;
    throw new AddonImportError('CUT_OFF');
  }
  assertStructuralLimits(json);
  assertPayloadVersion(json, header.version);
  const parsed = parseVersioned(json, header.version);
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
function finalize(pages: AnyAddonExport[]): DecodedAddonExport {
  const [first] = pages;
  if (!first) throw new AddonImportError('BAD_HEADER');
  if (first.section === 'guild') {
    const guild = pages.flatMap((p) => (p.section === 'guild' ? [p] : []));
    return sanitizeGuildExport(mergeGuildPages(guild));
  }
  if (first.section === 'raid') return sanitizeStrings(first);
  if (first.section === 'loot') return sanitizeLootExport(first);
  const { data, ...envelope } = first;
  const { mailworthy, addons } = data;
  return {
    ...sanitizeStrings(envelope),
    data: toCharSnapshotData(data),
    ...(mailworthy ? { mailworthy: sanitizeStrings(mailworthy) } : {}),
    ...(addons ? { addons: dedupeInstalled(sanitizeStrings(addons)) } : {}),
  };
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
  nowMs: number,
): DecodedAddonSection {
  const sha256 = normalisedHash(group.headers);
  try {
    const payload = finalize(group.headers.map(decodePage));
    assertPlausibleExportTimes(payload, nowMs);
    return { payload, pages: group.headers.length, sha256, inputBytes };
  } catch (err) {
    if (!mixed || !(err instanceof AddonImportError)) throw err;
    const label = ADDON_SECTION_LABEL[group.section];
    throw new AddonImportError(err.code, `${label}: ${err.body.message}`);
  }
}

function toSections(decoded: DecodedAddonSection[]): DecodedAddonSections {
  const sections: Partial<Record<AddonExportSectionV2, DecodedAddonSection>> =
    {};
  for (const d of decoded) sections[d.payload.section] = d;
  return sections as DecodedAddonSections;
}

/**
 * Decode a paste of one or more `!RL<v>!<section>[-<n>of<m>]!<base64(zlib(json))>`
 * tokens, v ∈ {1, 2} and one version per paste (ROK-2184) — one char, one
 * guild export (unpaged or every page once), one raid and (v2 only) one
 * loot, any order (ROK-1737). Order of guards, each before the next
 * allocates anything: input bytes → token count → headers + version +
 * grouping + page set → per section, per page: base64 length → bounded
 * inflate → JSON → structural limits → payload version → strict schema of
 * that version → same exporter across sections.
 * All-or-nothing: any failure rejects the whole paste. Throws
 * `AddonImportError`; never echoes input. `nowMs` is the server clock the
 * export timestamps are bounded by (defaults to `exportClock`).
 */
export function decodeImportPaste(
  raw: string,
  nowMs: number = exportClock.nowMs(),
): DecodedAddonPaste {
  const input = raw.trim();
  const inputBytes = Buffer.byteLength(input, 'utf8');
  if (inputBytes > ADDON_IMPORT_MAX_BYTES)
    throw new AddonImportError('TOO_LARGE');
  if (input === '') throw new AddonImportError('BAD_HEADER');
  const groups = parsePaste(input);
  const version = groups[0]?.headers[0]?.version;
  // Unreachable (defensive): `input` is non-empty and parsePaste throws on
  // any token without a valid header, so the first group always has one.
  if (version === undefined) throw new AddonImportError('BAD_HEADER');
  const mixed = groups.length > 1;
  const decoded = groups.map((g) =>
    decodeGroup(g, mixed ? g.bytes : inputBytes, mixed, nowMs),
  );
  assertSameExporter(decoded.map((d) => d.payload));
  return {
    sections: toSections(decoded),
    order: groups.map((g) => g.section),
    tokens: groups.reduce((n, g) => n + g.headers.length, 0),
    inputBytes,
    version,
  };
}

/**
 * Single-section compatibility path (the ROK-1724 import service): decode
 * the paste, then require exactly one section. A mixed paste is rejected
 * with `PAGES_INCOMPLETE` until the service handles several sections.
 */
export function decodeImportString(
  raw: string,
  nowMs: number = exportClock.nowMs(),
): DecodedAddonImport {
  const { sections, order } = decodeImportPaste(raw, nowMs);
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
