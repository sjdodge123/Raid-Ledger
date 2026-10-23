/**
 * ROK-1930 L5 — the Deaths fixture's invented cast and their map pins. Two
 * characters with profiles + a map each on one world, plus one name-only
 * player with no profile (an unlinked bar). Death counts are distinct
 * (5 / 3 / 1) so the card's descending order is unambiguous. All names are
 * invented; no real player data.
 */
import type { NewValheimMap } from '../../../drizzle/schema';

export type DeathsFixturePins = NewValheimMap['pins'];

/** The one world every fixture map and profile sits on. */
export const DEATHS_FIXTURE_WORLD_UID = '1930193019301';
export const DEATHS_FIXTURE_WORLD_NAME = 'Deathheim';

/** Name-only player: deaths with no SteamID and no matching profile. */
export const DEATHS_FIXTURE_UNLINKED_NAME = 'Wandrekr';

export interface DeathsFixtureCharacterPlan {
  key: 'top' | 'second';
  name: string;
  deaths: number;
  /** True: the death rows carry the SteamID; false: NULL (resolved by name, D7). */
  steamAttributed: boolean;
  pins: DeathsFixturePins;
}

const pin = (
  type: string,
  label: string,
  x: number,
  z: number,
  shared = false,
): DeathsFixturePins[number] => ({
  type,
  label,
  x,
  z,
  checked: false,
  shared,
});

/**
 * `top`: two Death pins, one non-death personal pin and one shared
 * (cartography-table) pin. `second`: one Death pin and one non-death pin.
 */
export const DEATHS_FIXTURE_CHARACTERS: readonly DeathsFixtureCharacterPlan[] =
  [
    {
      key: 'top',
      name: 'Ulfgrimr',
      deaths: 5,
      steamAttributed: true,
      pins: [
        pin('Death', '$hud_mapday 12', 640, 320),
        pin('Death', '$hud_mapday 31', -410, 880),
        pin('Icon0', 'Camp', 120, -40),
        pin('Icon3', 'Shared portal', 1200, -800, true),
      ],
    },
    {
      key: 'second',
      name: 'Sigrunna',
      deaths: 3,
      steamAttributed: false,
      pins: [
        pin('Death', '$hud_mapday 7', -900, -260),
        pin('Icon1', 'Copper', 300, 510),
      ],
    },
  ];

/** Deaths for the name-only player. */
export const DEATHS_FIXTURE_UNLINKED_DEATHS = 1;

/** Readable labels of a plan's Death pins, as the Map tab names them ("Day 12"). */
export function deathPinLabels(plan: DeathsFixtureCharacterPlan): string[] {
  return plan.pins
    .filter((p) => p.type === 'Death')
    .map((p) => p.label.replace('$hud_mapday ', 'Day '));
}
