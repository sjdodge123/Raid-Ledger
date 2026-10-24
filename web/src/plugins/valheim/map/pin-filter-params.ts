/**
 * ROK-1930 D10/D13, ROK-1943 D9/D10 — the Map pin filter's URL params.
 * Import-free on purpose: the eager Deaths "Show all" link reads it, so it must
 * not drag the map code into app-entry.
 */
/** Comma list of type-group ids; absent = every type. */
export const PINS_PARAM = 'pins';
export const DEATH_PINS = 'death';
/** `all` or a comma list of character ids; absent = this character (`vc`). */
export const PLAYERS_PARAM = 'players';
export const ALL_PLAYERS = 'all';
/** Label search text. */
export const QUERY_PARAM = 'q';
/** `hide` drops crossed-out (`checked`) pins; absent = shown. */
export const CROSSED_PARAM = 'crossed';
export const HIDE_CROSSED = 'hide';
/** "Show all": every player's Death pins on the selected world (D10 explicit form). */
export const DEATHS_SHOW_ALL_HREF = `?${PINS_PARAM}=${DEATH_PINS}&${PLAYERS_PARAM}=${ALL_PLAYERS}#map`;
