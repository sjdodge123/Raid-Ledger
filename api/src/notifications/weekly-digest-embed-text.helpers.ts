/**
 * Weekly Discord digest — text + link helpers for the embed (ROK-1435 L3).
 *
 * Pure string work: the per-section link targets (Decision 6a, verified
 * against `web/src/app-routes.tsx` on 2026-09-22), name sanitising, and the
 * fit-to-1024 truncation that ends every section with a masked "see all".
 */
import { gameDetailUrl } from '../discord-bot/services/discord-embed-event-chrome.helpers';

/** Discord embed limits (constraint ledger :50, :56). */
export const DIGEST_EMBED_LIMITS = {
  fieldValue: 1024,
  title: 256,
  total: 6000,
  fields: 25,
} as const;

/** Longest game name rendered before it is cut with an ellipsis. */
export const DIGEST_NAME_MAX = 100;

/** Zero-width space: breaks a mention token without changing how it reads. */
const ZWSP = String.fromCharCode(0x200b);

/**
 * Per-section "see all" targets. Every one resolves to a real web route:
 * - playing, deals → `/games` (no `/games/discover` route exists — it would
 *   fall into `/games/:id`; no deals-filtered view exists either);
 * - recap → `/events?tab=past` (the tabs are upcoming|past|mine|plans; there
 *   is no `history` tab);
 * - lfg → `/games?lfg=1` (no `/lfg` index; only `/lfg/:gameSlug`).
 */
export interface DigestLinks {
  base: string;
  playing: string;
  recap: string;
  deals: string;
  lfg: string;
}

/** Links for a configured web origin, or null so links are omitted. */
export function digestLinks(clientUrl: string | null): DigestLinks | null {
  const base = clientUrl?.trim().replace(/\/+$/, '');
  if (!base) return null;
  return {
    base,
    playing: `${base}/games`,
    recap: `${base}/events?tab=past`,
    deals: `${base}/games`,
    lfg: `${base}/games?lfg=1`,
  };
}

/** The game detail page for one line, when links are on. */
export function gameLink(
  links: DigestLinks | null,
  gameId: number,
): string | null {
  return gameDetailUrl(links?.base, gameId);
}

/** The LFG group page for one line, when links are on. */
export function lfgLink(
  links: DigestLinks | null,
  slug: string,
): string | null {
  return links ? `${links.base}/lfg/${encodeURIComponent(slug)}` : null;
}

/**
 * Make a game name safe for an embed: cap its length, escape markdown and
 * masked-link brackets, and break any `<@…>` / `@everyone` token so the digest
 * can never carry a mention (AC6, ledger :37-39).
 */
export function sanitizeName(name: string): string {
  const capped =
    name.length > DIGEST_NAME_MAX
      ? `${name.slice(0, DIGEST_NAME_MAX - 1)}…`
      : name;
  return capped
    .replace(/[\\*_~`|[\]()]/g, '\\$&')
    .replace(/</g, `<${ZWSP}`)
    .replace(/@/g, `@${ZWSP}`);
}

/** `**[name](url)**`, or `**name**` when there is no link. */
export function boldName(name: string, url: string | null): string {
  const safe = sanitizeName(name);
  return url ? `**[${safe}](${url})**` : `**${safe}**`;
}

/** `1 player` / `3 players`. */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** The closing line: `+N more · [see all ↗](url)`, either part optional. */
function sectionTail(
  hidden: number,
  seeAll: string | null,
  label: string,
): string | null {
  const parts: string[] = [];
  if (hidden > 0) parts.push(`+${String(hidden)} more`);
  if (seeAll) parts.push(`[${label} ↗](${seeAll})`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Join as many lines as fit in one field value, then the tail. Lines drop from
 * the bottom until the whole value is within {@link DIGEST_EMBED_LIMITS}; the
 * tail's "+N more" counts every item not shown, including the ones the data
 * layer already cut to its top N (`total`).
 */
export function fitSectionLines(
  lines: string[],
  total: number,
  seeAll: string | null,
  label = 'see all',
): string {
  for (let shown = lines.length; shown >= 0; shown -= 1) {
    const tail = sectionTail(Math.max(total - shown, 0), seeAll, label);
    const value = [...lines.slice(0, shown), ...(tail ? [tail] : [])].join(
      '\n',
    );
    if (value.length <= DIGEST_EMBED_LIMITS.fieldValue) return value;
  }
  return '';
}
