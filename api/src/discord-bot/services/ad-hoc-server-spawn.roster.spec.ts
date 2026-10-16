/**
 * ROK-1821 (RCA F4, known gap) — the server-born spawn card names a linked
 * player by their Raid Ledger name, never the in-game character name; an
 * unlinked player keeps the character name.
 */
import { spawnRoster } from './ad-hoc-server-spawn.helpers';

describe('spawnRoster (ROK-1821)', () => {
  it('a linked player shows their RL name, an unlinked one the character name', () => {
    const roster = spawnRoster(
      [
        { steamId: '76561198000000001', displayName: 'Bjorn' },
        { steamId: '76561198000000002', displayName: 'Sigrid' },
      ],
      [{ userId: 42, discordId: 'd-42', displayName: 'Roknua' }, null],
    );
    expect(roster).toEqual([
      { discordUserId: 'd-42', discordUsername: 'Roknua' },
      { discordUserId: null, discordUsername: 'Sigrid' },
    ]);
  });
});
