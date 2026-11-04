import { z } from 'zod';

// ============================================================
// Companion dev bridge v1 — BG3 body-wide redaction rules (ROK-2077).
// Applied to every string value AND object key of `bg3-saves` and
// `bg3-save-structure`, on top of the per-field patterns.
// ============================================================

const HEX = '[0-9A-Fa-f]';
const SEP = '[-_.]?';

/**
 * Every GUID shape the body must not hold:
 * - 32 hex digits split 8-4-4-4-12 by `-`, `_`, `.` or no separator (each gap
 *   independently) — this also catches the braced `{…}` form, the braces sit
 *   outside the match;
 * - a Larian handle, `h` + 8 hex + `g` + 4 hex (`h6f2b8c1eg4d3ag…`);
 * - any run of 32 or more hex digits.
 * A base64 GUID (22 alphanumerics) has no detectable shape — an accepted residual.
 */
const GUID_SHAPES: readonly RegExp[] = [
    new RegExp(`${HEX}{8}${SEP}${HEX}{4}${SEP}${HEX}{4}${SEP}${HEX}{4}${SEP}${HEX}{12}`),
    /h[0-9A-Fa-f]{8}g[0-9A-Fa-f]{4}/,
    /[0-9A-Fa-f]{32,}/,
];

/** A run of 10+ decimal digits: a SteamID64 (17 digits), a Larian profile id, an epoch-ms stamp. */
const DIGIT_RUN_RE = /[0-9]{10,}/;

export const DEV_BRIDGE_BG3_GUID_MESSAGE = 'A GUID is not allowed in a BG3 dev-bridge body';
export const DEV_BRIDGE_BG3_DIGITS_MESSAGE = 'A run of 10 or more digits (a profile or platform id) is not allowed in a BG3 dev-bridge body';

/** True when `s` holds any GUID shape above — the one GUID test every BG3 body uses. */
export function bg3HoldsGuid(s: string): boolean {
    return GUID_SHAPES.some((re) => re.test(s));
}

type Path = (string | number)[];

/**
 * `saveRef` is exempt from the digit rule only: it is already pinned to 12 hex
 * chars, and a hash prefix that happens to be 10+ decimal digits is not an id.
 */
function digitsExempt(path: Path): boolean {
    return path[path.length - 1] === 'saveRef';
}

function checkString(s: string, path: Path, ctx: z.RefinementCtx): void {
    if (bg3HoldsGuid(s)) {
        ctx.addIssue({ code: 'custom', path, message: DEV_BRIDGE_BG3_GUID_MESSAGE });
        return;
    }
    if (!digitsExempt(path) && DIGIT_RUN_RE.test(s)) ctx.addIssue({ code: 'custom', path, message: DEV_BRIDGE_BG3_DIGITS_MESSAGE });
}

/** Adds one `custom` issue at every string value or object key holding a GUID or a 10+ digit run. */
export function checkBg3Redaction(value: unknown, path: Path, ctx: z.RefinementCtx): void {
    if (typeof value === 'string') {
        checkString(value, path, ctx);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => checkBg3Redaction(v, [...path, i], ctx));
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value)) {
        checkString(key, [...path, key], ctx);
        checkBg3Redaction(v, [...path, key], ctx);
    }
}

/** Adds a `custom` issue at `[list, i, field]` for every repeat of a key already seen earlier in `items`. */
export function checkUniqueBy<T>(items: readonly T[], list: string, field: string, key: (item: T) => string | number, ctx: z.RefinementCtx): void {
    const seen = new Set<string | number>();
    items.forEach((item, i) => {
        const k = key(item);
        if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [list, i, field], message: `Duplicate ${field} ${k} in ${list}` });
        seen.add(k);
    });
}
