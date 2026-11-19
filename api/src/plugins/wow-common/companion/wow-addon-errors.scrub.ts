/**
 * ROK-2099 D8 — the server's re-scrub of `wow-addon-errors` strings (spec §6
 * rules 1, 3 and 5). The Companion scrubs first and the contract refuses a
 * drive-letter or `Users` path, so in the normal case this changes nothing;
 * it is defence in depth so a collector bug cannot land a home folder or the
 * uploader's character name in the database. Pure — no db, no Nest.
 */
import { createHash } from 'node:crypto';

/** Marker appended when a scrubbed string had to be cut back to its cap. */
export const SCRUB_TRUNCATED_MARKER = '…[truncated]';

/**
 * Rule 1a: an absolute path up to and including `World of Warcraft\_<flavor>_\`.
 * No `:` inside, so a match never starts back at an earlier
 * `Interface\AddOns\…\file.lua:NN:` on the same line (that part is kept).
 */
const WOW_PATH_RE =
  /(?:[A-Za-z]:)?[\\/][^\r\n"<>|:]*?World of Warcraft[\\/]_[A-Za-z0-9_]+_[\\/]/gi;
/** Rule 1b: a home folder, `X:\Users\<name>\` or `/Users/<name>/`. */
const HOME_PATH_RE = /(?:[A-Za-z]:)?[\\/]Users[\\/][^\\/\r\n]+[\\/]/gi;

/** The uploader's own names to blank out (rule 3); either may be absent. */
export interface ScrubNames {
  character?: string | undefined;
  realm?: string | undefined;
}

/** A string after the re-scrub, with how many replacements it took. */
export interface Scrubbed {
  value: string;
  replaced: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (letters/digits on neither side) matcher for a name. */
function nameRe(name: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
    'gu',
  );
}

function replaceCounting(
  input: Scrubbed,
  re: RegExp,
  token: string,
): Scrubbed {
  let hits = 0;
  const value = input.value.replace(re, () => {
    hits += 1;
    return token;
  });
  return { value, replaced: input.replaced + hits };
}

/** Rule 5: cut back to `max` UTF-16 units, ending in the truncation marker. */
export function truncateScrubbed(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - SCRUB_TRUNCATED_MARKER.length) + SCRUB_TRUNCATED_MARKER;
}

/** Re-scrub one string: WoW path, home path, then the uploader's names. */
export function scrubText(
  value: string,
  max: number,
  names: ScrubNames = {},
): Scrubbed {
  let out: Scrubbed = { value, replaced: 0 };
  out = replaceCounting(out, WOW_PATH_RE, '<wow>\\');
  out = replaceCounting(out, HOME_PATH_RE, '<home>\\');
  if (names.character) out = replaceCounting(out, nameRe(names.character), '<char>');
  if (names.realm) out = replaceCounting(out, nameRe(names.realm), '<realm>');
  return { value: truncateScrubbed(out.value, max), replaced: out.replaced };
}

/** D5: the dedupe hash of a SCRUBBED record (`stack` absent → empty). */
export function addonErrorRecordHash(
  addon: string,
  message: string,
  stack: string | null,
): string {
  return createHash('sha256')
    .update(`${addon}\n${message}\n${stack ?? ''}`, 'utf8')
    .digest('hex');
}
