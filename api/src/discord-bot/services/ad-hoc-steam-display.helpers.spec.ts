/**
 * Steam row display names are clamped to the varchar(255) columns they are
 * written to (`ad_hoc_participants.character_name` / `discord_username`), so
 * an absurdly long in-game name cannot roll back a Quick Play spawn.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import {
  STORED_NAME_MAX_LENGTH,
  characterNameOf,
  clampStoredName,
  resolveSteamRowDisplay,
} from './ad-hoc-steam-display.helpers';

const STEAM_ID = '76561198000000001';
const LONG_NAME = 'x'.repeat(300);

describe('clampStoredName', () => {
  it('cuts a 300-char name to 255 characters', () => {
    expect(STORED_NAME_MAX_LENGTH).toBe(255);
    expect(clampStoredName(LONG_NAME)).toBe('x'.repeat(255));
  });

  it('leaves a short name untouched', () => {
    expect(clampStoredName('Ragnar')).toBe('Ragnar');
  });

  it('never splits an astral character (counts code points, not UTF-16 units)', () => {
    const clamped = clampStoredName('😀'.repeat(300));
    expect(Array.from(clamped)).toHaveLength(255);
    expect(clamped).toBe('😀'.repeat(255));
  });
});

describe('characterNameOf — varchar(255) cap', () => {
  it('caps a 300-char character name at 255', () => {
    const name = characterNameOf({ steamId: STEAM_ID, displayName: LONG_NAME });
    expect(name).toBe('x'.repeat(255));
  });

  it('is still null while the player is only a SteamID64', () => {
    expect(characterNameOf({ steamId: STEAM_ID, displayName: STEAM_ID })).toBe(
      null,
    );
  });
});

describe('resolveSteamRowDisplay — unlinked 300-char name', () => {
  it('writes both name columns at 255 characters', async () => {
    const display = await resolveSteamRowDisplay(createDrizzleMock() as never, {
      steamId: STEAM_ID,
      displayName: LONG_NAME,
      userId: null,
    });
    expect(display.discordUsername).toBe('x'.repeat(255));
    expect(display.characterName).toBe('x'.repeat(255));
  });
});
