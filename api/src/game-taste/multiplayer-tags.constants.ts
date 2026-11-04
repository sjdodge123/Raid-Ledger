/**
 * ITAD/Steam tags that indicate multiplayer capability (ROK-931, ROK-1939).
 *
 * The ONE list both lineup-pool paths share: the wildcard picks
 * (`lineups/ai-suggestions/wildcard.helpers.ts`, exact-case `?|` match) and
 * the taste-matched `multiplayerOnly` eligibility
 * (`game-taste/queries/multiplayer-eligibility.sql.ts`, case-insensitive).
 * Add a tag here, never to either caller.
 */
export const MULTIPLAYER_TAGS: readonly string[] = [
  'Multiplayer',
  'Online Multiplayer',
  'Local Multiplayer',
  'Co-op',
  'Online Co-Op',
  'Local Co-Op',
  'PvP',
  'MMO',
  'Massively Multiplayer',
  'Online PvP',
  'Cross-Platform Multiplayer',
];
