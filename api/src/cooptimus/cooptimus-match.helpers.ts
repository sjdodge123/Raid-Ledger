/**
 * Co-Optimus ↔ our-games matching (ROK-1397). Pure helpers, unit-tested
 * against the ROK-275 probe's real fixtures.
 *
 * Pipeline (plan §4): the API's name search is a substring LIKE that
 * produced 6 false positives across 163 queried names ("Rust" → Distrust),
 * so a hit is accepted ONLY via (a) steam-id equality with our row (the
 * exact-match arbiter — never a primary key: their <steam> tag is sparse
 * and occasionally wrong) or (b) exact normalized-title equality with
 * roman↔arabic numeral folding. Anything else — including edition-suffix
 * base-title hits — routes to the review queue, never auto-maps.
 */
import type { CooptimusEntry } from './cooptimus-xml.util';
import { EDITION_SUFFIX_RE } from './cooptimus.constants';

const ROMAN: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7',
  viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13',
  xiv: '14', xv: '15', xvi: '16',
};

/** Lowercase, strip punctuation, fold roman-numeral tokens to arabic. */
export function normalizeTitle(name: string): string {
  const stripped = name
    .toLowerCase()
    .replace(/[™®:!'’.,\-–—()&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped
    .split(' ')
    .map((t) => ROMAN[t] ?? t)
    .join(' ');
}

/** Exact match under normalization — the only auto-accepted title relation. */
export function titlesMatchExact(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

/**
 * Strip a recognized edition/DLC suffix ("… Ultimate", "… Gold Edition",
 * "… Plus", trailing "+"). Returns the base title, or null when nothing
 * recognizable was stripped. Deliberately does NOT strip arbitrary
 * colon-subtitles — "Divinity: Original Sin" is not an edition of "Divinity".
 */
export function stripEditionSuffix(name: string): string | null {
  const base = name.replace(EDITION_SUFFIX_RE, '').trim();
  if (!base || base === name.trim()) return null;
  // A bare trailing colon can survive ("Mortal Kombat 11:" → clean it).
  return base.replace(/[:\-–]\s*$/, '').trim() || null;
}

/**
 * Choose one per-platform entry: prefer PC, else the newest entry by
 * Co-Optimus id (their ids are chronological; releasedate is documented
 * unreliable). 10 of 53 probe matches were console-only, so this is not an
 * edge case.
 */
export function pickPlatformEntry(
  entries: CooptimusEntry[],
): CooptimusEntry | null {
  if (entries.length === 0) return null;
  const pc = entries.filter((e) => e.system.toUpperCase() === 'PC');
  if (pc.length > 0) return pc.reduce((a, b) => (b.id > a.id ? b : a));
  return entries.reduce((a, b) => (b.id > a.id ? b : a));
}

/** Flags only present in the featurelist text (not discrete XML fields). */
export function deriveFeatureFlags(featurelist: string | null): {
  comboCoop: boolean;
  downloadableOnly: boolean;
} {
  const fl = featurelist ?? '';
  return {
    comboCoop: /combo\s+co-?op/i.test(fl),
    downloadableOnly: /downloadable\s+only/i.test(fl),
  };
}

export type MatchResult =
  | { status: 'matched'; entries: CooptimusEntry[]; method: 'steam-id' | 'name-exact' }
  | { status: 'review'; baseTitle: string; entries: CooptimusEntry[] }
  | { status: 'no-match' };

/**
 * Resolve search-result entries against one of our games. `entries` are ALL
 * rows the name search returned (multi-platform, possibly substring noise).
 */
export function matchEntries(
  entries: CooptimusEntry[],
  ourName: string,
  ourSteamAppId: number | null,
): MatchResult {
  // (a) steam-id arbiter — strongest signal when both sides have it.
  if (ourSteamAppId != null) {
    const bySteam = entries.filter((e) => e.steam === ourSteamAppId);
    if (bySteam.length > 0) {
      // Same game's other platform rows (steam tag only on PC) ride along
      // when their title matches the arbitered entry's title.
      const title = bySteam[0].title;
      const siblings = entries.filter((e) => titlesMatchExact(e.title, title));
      return { status: 'matched', entries: siblings, method: 'steam-id' };
    }
  }
  // (b) exact normalized title.
  const exact = entries.filter((e) => titlesMatchExact(e.title, ourName));
  if (exact.length > 0) {
    return { status: 'matched', entries: exact, method: 'name-exact' };
  }
  // (c) edition-suffix fallback → review queue only.
  const base = stripEditionSuffix(ourName);
  if (base) {
    const baseHits = entries.filter((e) => titlesMatchExact(e.title, base));
    if (baseHits.length > 0) {
      return { status: 'review', baseTitle: base, entries: baseHits };
    }
  }
  return { status: 'no-match' };
}
