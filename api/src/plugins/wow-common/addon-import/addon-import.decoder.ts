import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import {
  ADDON_IMPORT_MAX_BYTES,
  ADDON_IMPORT_MAX_DECODED_BYTES,
  ADDON_IMPORT_MAX_PAGES,
  AddonExportSchema,
  type AddonCharExport,
  type AddonCharSnapshotData,
  type AddonExport,
  type AddonGuildExport,
  type AddonRaidExport,
} from '@raid-ledger/contract';
import { AddonImportError } from './addon-import.errors';
import { assertStructuralLimits } from './addon-import.limits';
import {
  assertPageSet,
  mergeGuildPages,
  parsePageHeader,
  type AddonPageHeader,
} from './addon-import.pages';
import { sanitizeStrings, toCharSnapshotData } from './addon-import.sanitize';

/** Char export with `data` already in the frozen snapshot shape. */
export type DecodedAddonCharExport = Omit<AddonCharExport, 'data'> & {
  data: AddonCharSnapshotData;
};
/** Validated + sanitised payload, discriminated by `section`. */
export type DecodedAddonExport =
  DecodedAddonCharExport | AddonGuildExport | AddonRaidExport;

export interface DecodedAddonImport {
  payload: DecodedAddonExport;
  /** Pages merged (1 for an unpaged string). */
  pages: number;
  /** sha256 hex of the normalised input (pages sorted), computed pre-decode. */
  sha256: string;
  /** UTF-8 byte length of the trimmed input. */
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

/**
 * Decode a pasted `!RL1!<section>[-<n>of<m>]!<base64(zlib(json))>` string
 * (one or more whitespace-separated pages). Order of guards, each before
 * the next allocates anything: input bytes → page count → headers + page
 * set → per page: base64 length → bounded inflate → JSON → structural
 * limits → strict schema. Throws `AddonImportError`; never echoes input.
 */
export function decodeImportString(raw: string): DecodedAddonImport {
  const input = raw.trim();
  const inputBytes = Buffer.byteLength(input, 'utf8');
  if (inputBytes > ADDON_IMPORT_MAX_BYTES)
    throw new AddonImportError('TOO_LARGE');
  if (input === '') throw new AddonImportError('BAD_HEADER');
  const tokens = input.split(/\s+/);
  if (tokens.length > ADDON_IMPORT_MAX_PAGES) {
    throw new AddonImportError(
      'PAGES_INCOMPLETE',
      'That paste has too many pages.',
    );
  }
  const headers = assertPageSet(tokens.map(parsePageHeader));
  const sha256 = normalisedHash(headers);
  const payload = finalize(headers.map(decodePage));
  return { payload, pages: headers.length, sha256, inputBytes };
}
