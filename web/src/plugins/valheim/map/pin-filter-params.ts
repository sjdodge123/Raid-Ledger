/**
 * ROK-1930 D10/D13 — the Map tab's pin-type filter param. Import-free on purpose:
 * the eager Deaths "Show all" link reads it, so it must not drag the map code
 * into app-entry.
 */
export const PINS_PARAM = 'pins';
export const DEATH_PINS = 'death';
/** "Show all": every player's Death pins on the selected world (Q3 = A). */
export const DEATHS_SHOW_ALL_HREF = `?${PINS_PARAM}=${DEATH_PINS}#map`;
