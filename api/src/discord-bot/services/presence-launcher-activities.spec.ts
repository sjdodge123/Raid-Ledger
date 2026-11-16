import { ActivityType } from 'discord.js';
import {
  firstPlayingGameName,
  isLauncherActivity,
  playingGameNames,
} from './presence-launcher-activities';

const playing = (name: string): { type: ActivityType; name: string } => ({
  type: ActivityType.Playing,
  name,
});

describe('presence-launcher-activities (ROK-2204)', () => {
  it('matches whole launcher names only, trimmed and case-insensitive', () => {
    expect(isLauncherActivity('  curseFORGE ')).toBe(true);
    expect(isLauncherActivity('CurseForge Adventures')).toBe(false);
  });

  it('playingGameNames keeps Playing games and drops launchers', () => {
    const names = playingGameNames([
      playing('CurseForge'),
      { type: ActivityType.Listening, name: 'Spotify' },
      playing('Valheim'),
    ]);
    expect(names).toEqual(['Valheim']);
  });

  it('firstPlayingGameName skips a launcher listed first', () => {
    expect(
      firstPlayingGameName([playing('Overwolf'), playing('Valheim')]),
    ).toBe('Valheim');
  });

  it('firstPlayingGameName is null for a launcher-only or missing presence', () => {
    expect(firstPlayingGameName([playing('Battle.net')])).toBeNull();
    expect(firstPlayingGameName(undefined)).toBeNull();
  });
});
