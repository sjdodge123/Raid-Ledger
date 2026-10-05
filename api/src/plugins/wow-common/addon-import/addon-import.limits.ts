import { AddonImportError } from './addon-import.errors';

/** Deepest container nesting accepted (root object = depth 1). */
export const ADDON_JSON_MAX_DEPTH = 12;
/** Longest array accepted anywhere in the decoded JSON. */
export const ADDON_JSON_MAX_ARRAY = 2000;
/** Longest string (value OR object key) accepted, in UTF-8 bytes. */
export const ADDON_JSON_MAX_STRING_BYTES = 2048;

function reject(reason: string): never {
  throw new AddonImportError(
    'INVALID_PAYLOAD',
    `The import string's contents exceed a size limit (${reason}).`,
  );
}

function checkString(value: string): void {
  // Cheap pre-check: UTF-8 is at most 3 bytes per UTF-16 code unit.
  if (value.length * 3 <= ADDON_JSON_MAX_STRING_BYTES) return;
  if (Buffer.byteLength(value, 'utf8') > ADDON_JSON_MAX_STRING_BYTES) {
    reject('text too long');
  }
}

function walk(value: unknown, depth: number): void {
  if (typeof value === 'string') return checkString(value);
  if (value === null || typeof value !== 'object') return;
  if (depth > ADDON_JSON_MAX_DEPTH) reject('nested too deeply');
  if (Array.isArray(value)) {
    if (value.length > ADDON_JSON_MAX_ARRAY) reject('list too long');
    for (const item of value) walk(item, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    checkString(key);
    walk(item, depth + 1);
  }
}

/**
 * Structural guard run on the parsed JSON BEFORE schema validation, so a
 * hostile payload can't make Zod do unbounded work: container depth ≤ 12,
 * arrays ≤ 2000 items, strings and keys ≤ 2048 UTF-8 bytes. Throws
 * `INVALID_PAYLOAD` without echoing any value.
 */
export function assertStructuralLimits(json: unknown): void {
  walk(json, 1);
}
