import { GUILD_URL_MAX, type GuildAddonSource } from '@raid-ledger/contract';

/**
 * ROK-1786: server-side addon link parsing (prototype: `addon-url.ts` on
 * `spike/rok-1781-guild-page-prototype`). CurseForge / Wago / GitHub links
 * become a slug; any other http(s) link is stored as a plain `url` source.
 */
export interface ParsedAddonLink {
  source: GuildAddonSource;
  /** Lowercased slug (`owner/repo` on GitHub), or the normalised URL. */
  slugOrUrl: string;
  /** Title-cased name derived from the link, used when none is typed. */
  suggestedName: string;
  /** Canonical link-out (same as `addonLinkUrl(source, slugOrUrl)`). */
  url: string;
}

export type AddonLinkResult =
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
export function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Canonical link-out for a stored addon. */
export function addonLinkUrl(
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
