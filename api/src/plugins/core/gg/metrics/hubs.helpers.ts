/** The art columns of one live hub's game (`games.cover_url`, `games.screenshots`). */
export interface GgHubGameArt {
  coverUrl: string | null;
  screenshots: string[] | null;
}

/** Contract cap on `GgHubsCard.backdropUrls`. */
export const GG_HUB_BACKDROPS = 4;

const isHttps = (u: string | null | undefined): u is string =>
  typeof u === 'string' && u.startsWith('https://');

/**
 * Card 10 backdrops: per hub, its game's first https screenshot (else its
 * https cover) — deduped, in hub order, at most {@link GG_HUB_BACKDROPS}.
 */
export function hubBackdropsOf(rows: readonly GgHubGameArt[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const pick =
      (row.screenshots ?? []).find(isHttps) ??
      (isHttps(row.coverUrl) ? row.coverUrl : undefined);
    if (pick !== undefined && !out.includes(pick)) out.push(pick);
    if (out.length === GG_HUB_BACKDROPS) break;
  }
  return out;
}
