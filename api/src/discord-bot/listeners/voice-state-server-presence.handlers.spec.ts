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
import {
  handlePresenceChange,
  shouldSpawnImmediately,
} from './voice-state.handlers';
import { handleGeneralLobbyGroupDetection } from './voice-state-recovery.handlers';
import { resolveVoiceChannel } from './voice-state.helpers';
import {
  lobbySpawnFns,
  monitorSpawnFns,
} from './voice-state-join-dispatch.handlers';
import { serverAwareGameCount } from './voice-threshold-server-count.helpers';
import { suppressOrCheckThreshold } from './voice-state-gate.handlers';
import { switchLobbyMemberGame } from './voice-lobby-switch.helpers';

jest.mock('./voice-state.handlers', () => ({
  handlePresenceChange: jest.fn(() => Promise.resolve()),
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
  handleGeneralLobbyGroupDetection: jest.fn(),
}));
jest.mock('./voice-lobby-groups.helpers', () => ({
  resolveLobbyGroups: jest.fn(),
}));
jest.mock('./voice-state-join-dispatch.handlers', () => ({
  lobbySpawnFns: jest.fn(),
  monitorSpawnFns: jest.fn(),
}));
jest.mock('./voice-lobby-switch.helpers', () => ({
  switchLobbyMemberGame: jest.fn(() => Promise.resolve()),
}));
jest.mock('./voice-threshold-server-count.helpers', () => ({
  serverAwareGameCount: jest.fn(),
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
      adHocEventService: {
        getActiveState: jest.fn(() => state),
        handleVoiceLeave: jest.fn(() => Promise.resolve()),
      },
      usersService: {
        findByDiscordId: jest.fn((id: string) =>
          Promise.resolve(id === 'a' ? { id: 7 } : null),
        ),
      },
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
  it('moves only the group voice members not yet in the running event, via the presence-switch path (Codex r2 P2)', async () => {
    const gmA = { id: 'a' };
    const gmB = { id: 'b' };
    jest.mocked(resolveVoiceChannel).mockReturnValueOnce({
      id: 'vc',
      members: new Map([
        ['a', gmA],
        ['b', gmB],
      ]),
    } as never);
    jest.mocked(resolveLobbyGroups).mockResolvedValue({
      qualifying: [{ gameId: G, gameName: 'Valheim', memberIds: ['a', 'b'] }],
      dropped: [],
      minPlayers: 2,
      channelMemberCount: 2,
    });
    const ctx = ctxWith(['a']);
    await handleServerPresenceChanged(ctx, { pelicanServerId: 1, gameId: G });
    // handlePresenceChange leaves b's prior lobby event before joining G — a
    // direct add to G would leave b active in two events (ghost attendance).
    expect(jest.mocked(handlePresenceChange).mock.calls).toEqual([
      [ctx.deps, 'b', LOBBY, gmB],
    ]);
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

const MONITOR = {
  bindingId: 'mon',
  gameId: G,
  bindingPurpose: 'game-voice-monitor',
  config: { minPlayers: 3 },
} as unknown as ResolvedBinding;

function monitorCtx(): JoinHandlerCtx {
  return {
    channelMembers: new Map([['vc', new Set(['a', 'b'])]]),
    resolveAllBindings: () => Promise.resolve([MONITOR]),
    logger: { warn: jest.fn() },
    deps: {
      clientService: {},
      adHocEventService: { getActiveBindingEventGameId: jest.fn(() => null) },
    },
  } as unknown as JoinHandlerCtx;
}

function mockTally(counted: number): void {
  jest.mocked(serverAwareGameCount).mockResolvedValue({
    counted,
    confirmedCount: counted,
    allConfirmed: true,
  });
}

describe('handleServerPresenceChanged — general lobby switches (Codex r3 P2)', () => {
  it('moves an event member who left the server (still in voice, not in the group) out via the presence-switch path (Codex r3 P2)', async () => {
    const gmX = { id: 'x' };
    jest.mocked(resolveVoiceChannel).mockReturnValueOnce({
      id: 'vc',
      members: new Map([
        ['a', { id: 'a' }],
        ['b', { id: 'b' }],
        ['x', gmX],
      ]),
    } as never);
    mockGroup({ gameId: G, gameName: 'Valheim', memberIds: ['a', 'b'] });
    const ctx = ctxWith(['a', 'b', 'x']);
    await handleServerPresenceChanged(ctx, { pelicanServerId: 1, gameId: G });
    expect(jest.mocked(handlePresenceChange).mock.calls).toEqual([
      [ctx.deps, 'x', LOBBY, gmX],
    ]);
  });

  it('immediate spawn: every group member switches off their prior event before the group is rostered (Codex r3 P2)', async () => {
    jest.mocked(shouldSpawnImmediately).mockResolvedValueOnce(true);
    mockGroup({ gameId: G, gameName: 'Valheim', memberIds: ['a', 'b'] });
    const order: string[] = [];
    jest.mocked(switchLobbyMemberGame).mockImplementation((_d, _b, id) => {
      order.push(`switch:${id}`);
      return Promise.resolve();
    });
    jest.mocked(handleGeneralLobbyGroupDetection).mockImplementation(() => {
      order.push('spawn');
      return Promise.resolve();
    });
    await handleServerPresenceChanged(ctxWith(null), {
      pelicanServerId: 1,
      gameId: G,
    });
    expect(order).toEqual(['switch:a', 'switch:b', 'spawn']);
  });
});

describe('handleServerPresenceChanged — a server-driven switch leaves the prior game on every branch (ROK-1805)', () => {
  const VALHEIM_GROUP = { gameId: G, gameName: 'Valheim' };

  it.each([
    ['below threshold', ['a'], false],
    ['delayed spawn', ['a', 'b'], false],
    ['immediate spawn', ['a', 'b'], true],
  ] as const)(
    '%s: each group voice member is switched onto the game (leave old event + retrack)',
    async (_branch, memberIds, immediate) => {
      jest.mocked(shouldSpawnImmediately).mockResolvedValueOnce(immediate);
      const group = { ...VALHEIM_GROUP, memberIds: [...memberIds] };
      mockGroup(group);
      const ctx = ctxWith(null);
      await handleServerPresenceChanged(ctx, { pelicanServerId: 1, gameId: G });
      expect(jest.mocked(switchLobbyMemberGame).mock.calls).toEqual(
        memberIds.map((id) => [
          ctx.deps,
          LOBBY,
          id,
          group,
          id === 'a' ? 7 : null,
        ]),
      );
    },
  );
});

describe('handleServerPresenceChanged — game monitor (ROK-1801)', () => {
  const mfns = { scheduleSpawn: jest.fn(), cancelSpawn: jest.fn() };
  beforeEach(() => jest.mocked(monitorSpawnFns).mockReturnValue(mfns));

  it('a server player leaving drops voice + server below minPlayers → the pending timer is cancelled', async () => {
    mockTally(2); // two voice members, the third (server) player just left
    await handleServerPresenceChanged(monitorCtx(), {
      pelicanServerId: 1,
      gameId: G,
    });
    expect(mfns.cancelSpawn).toHaveBeenCalledTimes(1);
    expect(suppressOrCheckThreshold).toHaveBeenCalledTimes(1);
  });

  it('voice + server still at minPlayers → the pending timer is kept', async () => {
    mockTally(3);
    await handleServerPresenceChanged(monitorCtx(), {
      pelicanServerId: 1,
      gameId: G,
    });
    expect(mfns.cancelSpawn).not.toHaveBeenCalled();
    expect(suppressOrCheckThreshold).toHaveBeenCalledTimes(1);
  });
});
