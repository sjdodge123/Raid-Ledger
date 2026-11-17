/**
 * ROK-1888 — the unlinked-server and Discord-only row predicates.
 */
import {
  isAnonymousServerRow,
  isDiscordOnlyRow,
  isUnlinkedServerRow,
} from './ad-hoc-anonymous-row.helpers';

const STEAM = '76561198000000001';

const XUID = '2535411111111111';

/** A Steam row mirrors its SteamID into `playerId` (ROK-2232). */
function row(over: {
  userId?: number | null;
  discordUserId?: string | null;
  steamId?: string | null;
  playerId?: string | null;
  discordUsername?: string;
}) {
  return {
    userId: null,
    discordUserId: null,
    steamId: null,
    playerId: over.steamId ?? null,
    discordUsername: 'Loanati',
    ...over,
  };
}

describe('isUnlinkedServerRow (ROK-1888)', () => {
  it('matches a Steam row with no RL user and no Discord account', () => {
    expect(isUnlinkedServerRow(row({ steamId: STEAM }))).toBe(true);
  });

  it('does not match a Steam row linked to another RL user', () => {
    expect(isUnlinkedServerRow(row({ steamId: STEAM, userId: 7 }))).toBe(false);
  });

  it('does not match a voice row', () => {
    expect(isUnlinkedServerRow(row({ discordUserId: '111' }))).toBe(false);
    expect(
      isUnlinkedServerRow(row({ discordUserId: '111', steamId: STEAM })),
    ).toBe(false);
  });

  it('matches an XUID row with no RL user, no Discord account and no SteamID (ROK-2232)', () => {
    expect(isUnlinkedServerRow(row({ playerId: XUID }))).toBe(true);
  });

  it('does not match an XUID row linked to an RL user (ROK-2232)', () => {
    expect(isUnlinkedServerRow(row({ playerId: XUID, userId: 7 }))).toBe(false);
  });

  it('covers every anonymous (SteamID-named) row', () => {
    const anon = row({ steamId: STEAM, discordUsername: STEAM });
    expect(isAnonymousServerRow(anon)).toBe(true);
    expect(isUnlinkedServerRow(anon)).toBe(true);
  });
});

describe('isAnonymousServerRow (ROK-1801 Q4, ROK-2232)', () => {
  it('matches an unnamed XUID row, whose stored name is its XUID', () => {
    const anon = row({ playerId: XUID, discordUsername: XUID });
    expect(isAnonymousServerRow(anon)).toBe(true);
    expect(isUnlinkedServerRow(anon)).toBe(true);
  });

  it('does not match a named XUID row', () => {
    expect(isAnonymousServerRow(row({ playerId: XUID }))).toBe(false);
  });
});

describe('isDiscordOnlyRow (ROK-1888 OQ4)', () => {
  it('matches a voice member with no RL account', () => {
    expect(isDiscordOnlyRow(row({ discordUserId: '111' }))).toBe(true);
  });

  it('does not match an RL-linked voice member or a server row', () => {
    expect(isDiscordOnlyRow(row({ discordUserId: '111', userId: 3 }))).toBe(
      false,
    );
    expect(isDiscordOnlyRow(row({ steamId: STEAM }))).toBe(false);
  });
});
