/** IGDB genre ID → display name (common gaming genres) */
export const GENRE_MAP: Record<number, string> = {
  2: 'Point-and-click',
  4: 'Fighting',
  5: 'Shooter',
  7: 'Music',
  8: 'Platform',
  9: 'Puzzle',
  10: 'Racing',
  11: 'RTS',
  12: 'RPG',
  13: 'Simulator',
  14: 'Sport',
  15: 'Strategy',
  16: 'TBS',
  24: 'Tactical',
  25: 'Hack and slash',
  26: 'Quiz',
  30: 'Pinball',
  31: 'Adventure',
  32: 'Indie',
  33: 'Arcade',
  34: 'Visual Novel',
  35: 'Card Game',
  36: 'MOBA',
};

/** Look up an IGDB genre ID and return its display label, or `null` if unknown. */
export function getGenreLabel(genreId: number): string | null {
  return GENRE_MAP[genreId] ?? null;
}
