/**
 * ROK-1786 — client-side PREVIEW of a pasted addon link (name + source).
 *
 * MIRROR of the server parser `parseAddonLink` in
 * `api/src/plugins/wow-common/guilds/guild-addon-url.helpers.ts` — same host
 * rules, slug check, name derivation and error messages, so the preview and
 * the server's 400 agree. It is not shared through the contract because the
 * barrel would put it in the `use-auth` chunk (+0.5 KB over budget). Change
 * both together: the parity table is in `guild-content.helpers.test.ts` and
 * `guild-addon-url.helpers.spec.ts`.
 */
import { GUILD_URL_MAX, type GuildAddonSource } from '@raid-ledger/contract';

interface ParsedAddonLink {
    source: GuildAddonSource;
    /** Lowercased slug (`owner/repo` on GitHub), or the normalised URL. */
    slugOrUrl: string;
    /** Title-cased name derived from the link, used when none is typed. */
    suggestedName: string;
    /** Canonical link-out (same as `addonLinkUrl(source, slugOrUrl)`). */
    url: string;
}

type AddonLinkResult =
    { ok: true; link: ParsedAddonLink } | { ok: false; error: string };

interface HostRule {
    source: Exclude<GuildAddonSource, 'url'>;
    host: RegExp;
    /** Path segments that must precede the slug. */
    prefix: readonly string[];
    /** How many segments make the slug (GitHub: owner + repo). */
    slugParts: number;
    label: string;
}

const HOST_RULES: readonly HostRule[] = [
    {
        source: 'curseforge',
        host: /^(www\.)?curseforge\.com$/,
        prefix: ['wow', 'addons'],
        slugParts: 1,
        label: 'CurseForge links must look like curseforge.com/wow/addons/<name>',
    },
    {
        source: 'wago',
        host: /^addons\.wago\.io$/,
        prefix: ['addons'],
        slugParts: 1,
        label: 'Wago links must look like addons.wago.io/addons/<name>',
    },
    {
        source: 'github',
        host: /^(www\.)?github\.com$/,
        prefix: [],
        slugParts: 2,
        label: 'GitHub links must look like github.com/<owner>/<repo>',
    },
];

const SLUG_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

/** `my-addon_name` → `My Addon Name`. */
function titleCaseSlug(slug: string): string {
    return slug
        .split(/[-_.\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/** Canonical link-out for a stored addon. */
function addonLinkUrl(
    source: GuildAddonSource,
    slugOrUrl: string,
): string {
    switch (source) {
        case 'curseforge':
            return `https://www.curseforge.com/wow/addons/${slugOrUrl}`;
        case 'wago':
            return `https://addons.wago.io/addons/${slugOrUrl}`;
        case 'github':
            return `https://github.com/${slugOrUrl}`;
        case 'url':
            return slugOrUrl;
    }
}

function toHttpUrl(raw: string): URL | null {
    try {
        const url = new URL(raw.trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch {
        return null;
    }
}

function slugFromPath(parts: string[], rule: HostRule): string | null {
    const head = parts.slice(0, rule.prefix.length);
    if (head.join('/') !== rule.prefix.join('/')) return null;
    const segs = parts.slice(
        rule.prefix.length,
        rule.prefix.length + rule.slugParts,
    );
    if (segs.length !== rule.slugParts) return null;
    const clean = segs.map((s) => s.replace(/\.git$/, ''));
    return clean.every((s) => SLUG_SEGMENT.test(s)) ? clean.join('/') : null;
}

function matchHost(url: URL, rule: HostRule): AddonLinkResult {
    const parts = url.pathname.toLowerCase().split('/').filter(Boolean);
    const slug = slugFromPath(parts, rule);
    if (!slug) return { ok: false, error: rule.label };
    const name = titleCaseSlug(slug.split('/').pop() ?? slug);
    const link = addonLinkUrl(rule.source, slug);
    return {
        ok: true,
        link: {
            source: rule.source,
            slugOrUrl: slug,
            suggestedName: name,
            url: link,
        },
    };
}

function plainUrl(url: URL): AddonLinkResult {
    url.hash = '';
    const normalised = url.toString();
    if (normalised.length > GUILD_URL_MAX) {
        return {
            ok: false,
            error: `Links are limited to ${GUILD_URL_MAX} characters`,
        };
    }
    const last = url.pathname.split('/').filter(Boolean).pop();
    const name = titleCaseSlug(last ?? url.hostname.replace(/^www\./, ''));
    return {
        ok: true,
        link: {
            source: 'url',
            slugOrUrl: normalised,
            suggestedName: name,
            url: normalised,
        },
    };
}

/** Parse a pasted addon link; never throws. */
export function parseAddonLink(raw: string): AddonLinkResult {
    const url = toHttpUrl(raw);
    if (!url) return { ok: false, error: 'Paste a full http(s) link' };
    const host = url.hostname.toLowerCase();
    const rule = HOST_RULES.find((r) => r.host.test(host));
    return rule ? matchHost(url, rule) : plainUrl(url);
}

export interface ParsedAddonUrl { name: string; source: GuildAddonSource }

export type AddonUrlPreview = { ok: true; addon: ParsedAddonUrl } | { ok: false; error: string };

/** The preview, or the server's own rejection message. */
export function previewAddonUrl(raw: string): AddonUrlPreview {
    const result = parseAddonLink(raw);
    return result.ok
        ? { ok: true, addon: { name: result.link.suggestedName, source: result.link.source } }
        : { ok: false, error: result.error };
}

/** `null` for anything the server would reject. */
export function parseAddonUrl(raw: string): ParsedAddonUrl | null {
    const preview = previewAddonUrl(raw);
    return preview.ok ? preview.addon : null;
}
