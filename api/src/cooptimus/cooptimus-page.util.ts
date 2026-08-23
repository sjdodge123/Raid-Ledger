/**
 * Co-Optimus game-page parser.
 *
 * WHY THIS EXISTS: the keyless XML API (`games.php`) does NOT expose every
 * co-op fact their site renders. Measured against 161 live records, the
 * `<featurelist>` vocabulary is exactly four tokens — "Campaign Co-Op",
 * "Drop-In/Drop-Out", "Splitscreen", "Co-Op Modes" — each of which already has
 * its own discrete XML element. "Combo Co-Op" and "Downloadable Only" never
 * appear in the payload at all, yet both are rendered on the game page.
 *
 * The previous approach regex-matched the featurelist for those two strings, so
 * both flags were unconditionally false for every game since ROK-1397 — Baldur's
 * Gate III showed "Combo Co-Op: Not Supported" while co-optimus.com showed
 * "Up to 4 Local or Online". Combo is also NOT derivable from the numbers:
 * Portal 2 reports local=2 AND online=2 yet their page says Not Supported.
 *
 * So the page is the only source. Everything here returns `null` when the
 * markup isn't found — an unknown fact must never be rendered as a negative
 * claim underneath the "Co-op data from Co-Optimus" credit.
 */

export interface CooptimusPageFacts {
  /** null = we could not determine it (missing/changed markup). */
  comboCoop: boolean | null;
  /** Their exact wording, e.g. "Up to 4 Local or Online". */
  comboLabel: string | null;
  downloadableOnly: boolean | null;
}

export const UNKNOWN_PAGE_FACTS: CooptimusPageFacts = {
  comboCoop: null,
  comboLabel: null,
  downloadableOnly: null,
};

const CORE_BLOCK_RE = /id="coop-features"[\s\S]*?<dl>([\s\S]*?)<\/dl>/i;
const EXTRAS_BLOCK_RE = /id="coop-extras"[^>]*>([\s\S]*?)<\/ul>/i;
const DT_DD_RE =
  /<dt>([\s\S]*?)<\/dt>\s*<dd[^>]*>[\s\S]*?<em>([\s\S]*?)<\/em>/gi;
const LI_RE = /<li[^>]*>([\s\S]*?)<\/li>/gi;

/** Strip tags/entities and collapse whitespace. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The "Combo Co-Op (Local + Online)" row of the Core Features list. */
function readCombo(
  html: string,
): Pick<CooptimusPageFacts, 'comboCoop' | 'comboLabel'> {
  const block = CORE_BLOCK_RE.exec(html);
  if (!block) return { comboCoop: null, comboLabel: null };
  for (const [, dt, dd] of block[1].matchAll(DT_DD_RE)) {
    if (!/combo/i.test(text(dt))) continue;
    const value = text(dd);
    if (!value) return { comboCoop: null, comboLabel: null };
    // "Not Supported" is a real reported negative — keep it as false, not null.
    if (/not\s+supported/i.test(value))
      return { comboCoop: false, comboLabel: value };
    return { comboCoop: true, comboLabel: value };
  }
  // Block present but no combo row: they render one for every game we've seen,
  // so its absence means the markup moved — unknown, not false.
  return { comboCoop: null, comboLabel: null };
}

/** "Downloadable Only" is an item in the Co-Op Extras list, not a labelled row. */
function readDownloadableOnly(html: string): boolean | null {
  const block = EXTRAS_BLOCK_RE.exec(html);
  if (!block) return null;
  const items = [...block[1].matchAll(LI_RE)].map(([, li]) => text(li));
  if (items.length === 0) return null;
  return items.some((i) => /downloadable\s+only/i.test(i));
}

/** Parse one Co-Optimus game page. Never throws — unparseable ⇒ all null. */
export function parseGamePage(html: string | null): CooptimusPageFacts {
  if (!html) return UNKNOWN_PAGE_FACTS;
  return { ...readCombo(html), downloadableOnly: readDownloadableOnly(html) };
}
