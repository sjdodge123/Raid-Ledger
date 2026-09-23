/**
 * Parsers over `index.css` for the light-family colour guards (ROK-1586).
 *
 * Pure string work — no DOM. Kept out of the guard so the selector matching can be
 * unit-tested against hand-written CSS (e.g. a reordered `:is(...)` scheme list).
 */

/** One light scheme and the two backgrounds text is read on. */
export interface LightScheme {
    name: string;
    surface: string;
    panel: string;
}

/** A light-family `color:` repaint of a raw Tailwind text class. */
export interface LightTextRule {
    /** The class as written in markup: `text-red-400`, `text-red-400/60`, `hover:text-red-300`. */
    cls: string;
    hue: string;
    /** Opaque `#rrggbb` of the painted colour. */
    color: string;
    /** `1` for a hex repaint, the rgba alpha otherwise. */
    alpha: number;
}

const SCHEME_ITEM = /^\[data-scheme="([a-z-]+)"\]$/;

/** The scheme names of a `[data-scheme="a"],[data-scheme="b"]` list, or `null` if any item is something else. */
export function parseSchemeGroup(group: string): string[] | null {
    const names = group.split(',').map((item) => SCHEME_ITEM.exec(item.trim())?.[1]);
    return names.every((n): n is string => n !== undefined) ? names : null;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `--color-{name}` declared in the first `selector { … }` block that declares it. */
function declared(css: string, selector: string, name: string): string | undefined {
    const blocks = new RegExp(`(?:^|[\\s}])${escape(selector)}\\s*\\{([^}]*)\\}`, 'g');
    for (const [, body] of css.matchAll(blocks)) {
        const hit = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body);
        if (hit) return hit[1].toLowerCase();
    }
    return undefined;
}

/**
 * Every light scheme with its effective surface and panel: the shared
 * `:is(<light schemes>) { … }` token block, overridden by the scheme's own
 * `[data-scheme="x"]` (or `[data-variant="x"]`) block.
 */
export function lightSchemes(css: string): LightScheme[] {
    for (const [, group] of css.matchAll(/:is\(([^()]*)\)\s*\{[^}]*--color-surface:/g)) {
        const names = parseSchemeGroup(group);
        if (!names) continue;
        const shared = `:is(${group})`;
        const pick = (scheme: string, token: string) =>
            declared(css, `[data-scheme="${scheme}"]`, token) ??
            declared(css, `[data-variant="${scheme}"]`, token) ??
            declared(css, shared, token);
        return names.map((name) => ({ name, surface: pick(name, 'surface') ?? '', panel: pick(name, 'panel') ?? '' }));
    }
    return [];
}

/** `:is(<schemes>) .[hover\:]text-{hue}-{shade}[\/NN][:hover] { color: #hex | rgba(...) }` */
const RULE =
    /:is\(([^()]*)\)\s+\.(hover\\:)?text-([a-z]+)-(\d{2,3})(?:\\\/(\d{1,3}))?(?::hover)?\s*\{\s*color:\s*(#[0-9a-fA-F]{6}|rgba\([^)]*\))\s*;?\s*\}/g;

function toColor(raw: string): { color: string; alpha: number } {
    if (raw.startsWith('#')) return { color: raw.toLowerCase(), alpha: 1 };
    const [r, g, b, a] = raw.replace(/rgba\(|\)/g, '').split(',').map((n) => Number(n.trim()));
    const hex = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    return { color: `#${hex}`, alpha: a };
}

/**
 * Every plain text repaint scoped to exactly the light scheme set (in any order).
 * Rules scoped to a subset, or with anything between the scheme list and the class
 * (the `.badge-overlay` rules), are not light text repaints and are skipped.
 */
export function lightTextRules(css: string, schemes: string[]): LightTextRule[] {
    return [...css.matchAll(RULE)].flatMap(([, group, hover, hue, shade, opacity, raw]) => {
        const names = parseSchemeGroup(group);
        if (!names || !sameSet(names, schemes)) return [];
        const cls = `${hover ? 'hover:' : ''}text-${hue}-${shade}${opacity ? `/${opacity}` : ''}`;
        return [{ cls, hue, ...toColor(raw) }];
    });
}
