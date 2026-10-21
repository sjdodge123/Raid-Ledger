/**
 * ROK-1888 Codex P1 + P2: a lobby member whose game is already live in another
 * channel is enrolled NOW — never dropped below `minPlayers`, never parked on
 * the new-event spawn delay.
 */
import type { GuildMember } from 'discord.js';
import { handleGeneralLobbyJoin } from './voice-state-join.handlers';
import { isGameLive } from './voice-live-game.helpers';
import { lobbyGroupSize } from './voice-lobby-groups.helpers';
import { handleGeneralLobbyGroupDetection } from './voice-state-recovery.handlers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import type { ResolvedBinding } from './voice-state.helpers';

jest.mock('./voice-live-game.helpers', () => ({
  isGameLive: jest.fn(),
  bypassesMinPlayers: jest.fn(),
}));
jest.mock('./voice-lobby-groups.helpers', () => ({
  detectLobbyMemberGame: jest.fn(() =>
    Promise.resolve({ gameId: 7, gameName: 'Valheim' }),
  ),
  isBotMember: jest.fn(() => false),
  lobbyGroupSize: jest.fn(),
}));
jest.mock('./voice-state-recovery.handlers', () => ({
  handleGameSpecificGroupRoster: jest.fn(),
  handleGeneralLobbyGroupDetection: jest.fn(() => Promise.resolve()),
}));
jest.mock('./voice-state.handlers', () => ({
  shouldSpawnImmediately: jest.fn(() => Promise.resolve(false)),
  startVoiceGameTracking: jest.fn(),
}));

const logger = {
  log: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  verbose: jest.fn(),
};
const deps = {
  logger,
  channelMembers: new Map([['ch-b', new Set(['u1'])]]),
  usersService: { findByDiscordId: jest.fn(() => Promise.resolve(null)) },
  adHocEventService: {
    getActiveState: jest.fn(() => undefined),
    handleVoiceJoin: jest.fn(() => Promise.resolve(true)),
  },
} as unknown as VoiceHandlerDeps;
const binding = {
  bindingId: 'b-lobby',
  bindingPurpose: 'general-lobby',
  gameId: null,
  config: { minPlayers: 2 },
} as unknown as ResolvedBinding;
const dm = {
  discordUserId: 'u1',
  discordUsername: 'one',
  discordAvatarHash: null,
};
const gm = { id: 'u1' } as unknown as GuildMember;

function scheduleFns() {
  return {
    scheduleRecheck: jest.fn(),
    scheduleSpawn: jest.fn(),
    cancelSpawn: jest.fn(),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('general-lobby join while the game is live elsewhere (ROK-1888)', () => {
  it('enrols a lone player below minPlayers into the live Quick Play (Codex P1)', async () => {
    jest.mocked(lobbyGroupSize).mockResolvedValue(1);
    jest.mocked(isGameLive).mockResolvedValue(true);
    const fns = scheduleFns();

    await handleGeneralLobbyJoin(deps, 'ch-b', binding, dm, gm, fns);

    expect(handleGeneralLobbyGroupDetection).toHaveBeenCalledWith(
      deps,
      'ch-b',
      binding,
      7,
    );
    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
  });

  it('skips the new-event spawn delay for a live target at threshold (Codex P2)', async () => {
    jest.mocked(lobbyGroupSize).mockResolvedValue(3);
    jest.mocked(isGameLive).mockResolvedValue(true);
    const fns = scheduleFns();

    await handleGeneralLobbyJoin(deps, 'ch-b', binding, dm, gm, fns);

    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
    expect(handleGeneralLobbyGroupDetection).toHaveBeenCalledWith(
      deps,
      'ch-b',
      binding,
      7,
    );
  });

  it('still drops a lone player when the game has no live Quick Play', async () => {
    jest.mocked(lobbyGroupSize).mockResolvedValue(1);
    jest.mocked(isGameLive).mockResolvedValue(false);
    const fns = scheduleFns();

    await handleGeneralLobbyJoin(deps, 'ch-b', binding, dm, gm, fns);

    expect(handleGeneralLobbyGroupDetection).not.toHaveBeenCalled();
    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
  });
});
