/**
 * ROK-1786 — client-side PREVIEW of a pasted addon link (name + source). The
 * server parses and validates for real (`guild-addon-url.helpers.ts`); this
 * only mirrors its recognised shapes so the form can show what it will add.
 */
import type { GuildAddonSource } from '@raid-ledger/contract';

export interface ParsedAddonUrl { name: string; source: GuildAddonSource }

const PATTERNS: Array<{ source: GuildAddonSource; host: RegExp; slugAt: number; prefix?: string }> = [
    { source: 'curseforge', host: /^(www\.)?curseforge\.com$/, slugAt: 2, prefix: 'wow' },
    { source: 'wago', host: /^addons\.wago\.io$/, slugAt: 1 },
    { source: 'github', host: /^(www\.)?github\.com$/, slugAt: 1 },
];

export function titleCaseSlug(slug: string): string {
    return slug.replace(/\.git$/, '').split(/[-_]+/).filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function toUrl(raw: string): URL | null {
    try {
        const u = new URL(raw.trim());
        return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch {
        return null;
    }
}

/** `null` for anything that isn't an http(s) link; other hosts preview as a plain website. */
export function parseAddonUrl(raw: string): ParsedAddonUrl | null {
    const url = toUrl(raw);
    if (!url) return null;
    const match = PATTERNS.find((p) => p.host.test(url.hostname));
    if (!match) return { name: url.hostname.replace(/^www\./, ''), source: 'url' };
    const parts = url.pathname.split('/').filter(Boolean);
    if (match.prefix && parts[0] !== match.prefix) return null;
    const slug = parts[match.slugAt];
    return slug ? { name: titleCaseSlug(slug), source: match.source } : null;
}
