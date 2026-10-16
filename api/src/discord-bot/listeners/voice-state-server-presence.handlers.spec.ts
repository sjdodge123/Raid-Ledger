/**
 * ROK-1801 (Codex P2s) — CHANGED re-evaluation of a general lobby: a running
 * event takes the group's new voice members, and a group that drops below
 * `minPlayers` loses its pending spawn timer.
 */
import { handleServerPresenceChanged } from './voice-state-server-presence.handlers';
import type { JoinHandlerCtx } from './voice-state-join-dispatch.handlers';
import type { ResolvedBinding } from './voice-state.helpers';
import type { LobbyGameGroup } from './voice-lobby-groups.helpers';
import { resolveLobbyGroups } from './voice-lobby-groups.helpers';
import { addDetectedMembers } from './voice-state-recovery.handlers';
import { lobbySpawnFns } from './voice-state-join-dispatch.handlers';

jest.mock('./voice-state.handlers', () => ({
  markLobbyDirty: jest.fn(),
  shouldSpawnImmediately: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('./voice-state-gate.handlers', () => ({
  suppressOrCheckThreshold: jest.fn(),
}));
jest.mock('./voice-state-join.handlers', () => ({
  handleGameBindingJoin: jest.fn(),
}));
jest.mock('./voice-state-recovery.handlers', () => ({
  addDetectedMembers: jest.fn(() => Promise.resolve()),
  handleGeneralLobbyGroupDetection: jest.fn(),
}));
jest.mock('./voice-lobby-groups.helpers', () => ({
  resolveLobbyGroups: jest.fn(),
}));
jest.mock('./voice-state-join-dispatch.handlers', () => ({
  lobbySpawnFns: jest.fn(),
  monitorSpawnFns: jest.fn(),
}));
jest.mock('./voice-state.helpers', () => ({
  ...jest.requireActual<object>('./voice-state.helpers'),
  resolveVoiceChannel: jest.fn(() => ({ id: 'vc', members: new Map() })),
}));

const G = 10;
const LOBBY = {
  bindingId: 'lobby',
  gameId: null,
  bindingPurpose: 'general-lobby',
  config: { minPlayers: 2 },
} as unknown as ResolvedBinding;

function ctxWith(activeMembers: string[] | null): JoinHandlerCtx {
  const state = activeMembers ? { memberSet: new Set(activeMembers) } : null;
  return {
    channelMembers: new Map([['vc', new Set(['a', 'b'])]]),
    resolveAllBindings: () => Promise.resolve([LOBBY]),
    logger: { warn: jest.fn() },
    deps: {
      clientService: {},
      adHocEventService: { getActiveState: jest.fn(() => state) },
    },
  } as unknown as JoinHandlerCtx;
}

function mockGroup(group: LobbyGameGroup): void {
  jest.mocked(resolveLobbyGroups).mockResolvedValue({
    qualifying: [],
    dropped: [group],
    minPlayers: 2,
    channelMemberCount: group.memberIds.length,
  });
}

const fns = { scheduleSpawn: jest.fn(), cancelSpawn: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(lobbySpawnFns).mockReturnValue(fns);
});

describe('handleServerPresenceChanged — general lobby (ROK-1801)', () => {
  it('joins the group voice members not yet in the running event', async () => {
    jest.mocked(resolveLobbyGroups).mockResolvedValue({
      qualifying: [{ gameId: G, gameName: 'Valheim', memberIds: ['a', 'b'] }],
      dropped: [],
      minPlayers: 2,
      channelMemberCount: 2,
    });
    await handleServerPresenceChanged(ctxWith(['a']), {
      pelicanServerId: 1,
      gameId: G,
    });
    expect(addDetectedMembers).toHaveBeenCalledTimes(1);
    const groups = jest.mocked(addDetectedMembers).mock.calls[0]?.[2];
    expect(groups?.map((g) => g.memberIds)).toEqual([['b']]);
  });

  it('cancels the game pending spawn when the group falls below minPlayers', async () => {
    mockGroup({ gameId: G, gameName: 'Valheim', memberIds: ['a'] });
    await handleServerPresenceChanged(ctxWith(null), {
      pelicanServerId: 1,
      gameId: G,
    });
    expect(fns.cancelSpawn).toHaveBeenCalledWith(G);
    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
  });

  it('a server-only group (no voice members) arms no lobby timer (review MINOR 3)', async () => {
    const player = {
      key: 'steam:s',
      steamId: 's',
      userId: null,
      discordUserId: null,
      name: null,
    };
    mockGroup({
      gameId: G,
      gameName: 'Valheim',
      memberIds: [],
      serverOnly: [player, { ...player, key: 'steam:t', steamId: 't' }],
    });
    await handleServerPresenceChanged(ctxWith(null), {
      pelicanServerId: 1,
      gameId: G,
    });
    expect(fns.scheduleSpawn).not.toHaveBeenCalled();
    expect(fns.cancelSpawn).not.toHaveBeenCalled();
  });
});
