/**
 * ROK-1782 — multi-binding Quick Play. Prod: #Gamer Night carried a BG3
 * Activity Monitor AND a General Lobby; nobody played BG3, two played Valheim,
 * and the bot minted "Gaming — Quick Play" rostering all four.
 *
 * Rulings under test:
 *  (a) a general lobby on the channel wins — its per-game groups decide;
 *  (c) presence updates are evaluated against EVERY binding on the channel.
 */
import { ActivityType, type GuildMember, type Presence } from 'discord.js';
import {
  handlePresenceUpdate,
  type JoinHandlerCtx,
} from './voice-state-join-dispatch.handlers';
import type { ResolvedBinding } from './voice-state.helpers';
import {
  gameBinding,
  lobbyBinding,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const BG3 = { gameId: 1, gameName: "Baldur's Gate 3" };
const VALHEIM = { gameId: 2, gameName: 'Valheim' };

/** A BG3 monitor with Just Chatting OFF (the prod shape). */
const monitor = (): Record<string, unknown> =>
  gameBinding({ gameName: BG3.gameName, config: { minPlayers: 2 } });

let h: Rok1445Harness;
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  h?.teardown();
  jest.useRealTimers();
});

/** Harness whose channel resolves to the monitor FIRST, then the lobby. */
async function monitorThenLobby(): Promise<Rok1445Harness> {
  const harness = await setupRok1445Harness(monitor());
  harness.mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue(
    [monitor(), lobbyBinding()],
  );
  return harness;
}

function joinsFor(bindingId: string): { memberId: string; gameId: unknown }[] {
  return h
    .joinCalls()
    .filter((c) => c.bindingId === bindingId)
    .map((c) => ({ memberId: c.memberId, gameId: c.gameId }));
}

describe('ROK-1782 (c) — presence updates fan out to every binding', () => {
  it('reaches the general lobby even when the monitor is the first row', async () => {
    h = await monitorThenLobby();
    for (const id of ['u1', 'u2', 'u3', 'u4'])
      await h.joinMember({ id, gameId: null });
    await h.changePresence('u1', VALHEIM);
    await h.changePresence('u2', VALHEIM);
    expect(joinsFor('bind-gl')).toEqual([{ memberId: 'u2', gameId: 2 }]);
  });
});

describe('ROK-1782 (a) — a general lobby outranks a co-channel monitor', () => {
  it('mints only the lobby Valheim group; the BG3 monitor never spawns', async () => {
    h = await monitorThenLobby();
    await h.joinMember({ id: 'u1', ...VALHEIM });
    await h.joinMember({ id: 'u2', ...VALHEIM });
    await h.joinMember({ id: 'u3', gameId: null });
    await h.joinMember({ id: 'u4', gameId: null });
    await h.advanceSpawnDelay();
    expect(h.eventKeys()).toEqual(['bind-gl:2']);
    expect(h.rosterOf('bind-gl:2').sort()).toEqual(['u1', 'u2']);
    expect(joinsFor('bind-game')).toEqual([]);
    expect(h.gateLines().some((l) => l.includes('yielded-to-lobby'))).toBe(
      true,
    );
  });
});

describe('ROK-1782 (a) — no duplicate event when both bindings match', () => {
  it('two BG3 players get ONE lobby BG3 event, not a second monitor event', async () => {
    h = await monitorThenLobby();
    await h.joinMember({ id: 'u3', gameId: null });
    await h.joinMember({ id: 'u1', ...BG3 });
    await h.joinMember({ id: 'u2', ...BG3 });
    await h.advanceSpawnDelay();
    expect(h.eventKeys()).toEqual(['bind-gl:1']);
    expect(joinsFor('bind-game')).toEqual([]);
  });
});

describe('ROK-1782 (a) — a yielded monitor never cancels a lobby spawn', () => {
  it('a leave below the monitor minPlayers keeps the lobby BG3 timer', async () => {
    h = await setupRok1445Harness(monitor());
    const bigMonitor = gameBinding({
      gameName: BG3.gameName,
      config: { minPlayers: 5 },
    });
    h.mocks.channelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      bigMonitor,
      lobbyBinding(),
    ]);
    // Interleaved so the lobby BG3 group is ARMED, not spawned immediately.
    await h.joinMember({ id: 'u1', ...BG3 });
    await h.joinMember({ id: 'u3', ...VALHEIM });
    await h.joinMember({ id: 'u2', ...BG3 });
    expect(h.spawnTimerKeys()).toHaveLength(1);
    // Occupancy drops to 2 < the monitor's 5 — the shared (channel, BG3) key.
    await h.leaveMember('u3');
    expect(h.spawnTimerKeys()).toHaveLength(1);
    await h.advanceSpawnDelay();
    expect(h.eventKeys()).toEqual(['bind-gl:1']);
  });
});

describe('ROK-1782 (c) — monitor presence recheck only on a game change', () => {
  const bg3Monitor: ResolvedBinding = {
    bindingId: 'bind-game',
    gameId: BG3.gameId,
    gameName: BG3.gameName,
    bindingPurpose: 'game-voice-monitor',
    recurrenceGroupId: null,
    config: { minPlayers: 2 },
  };
  const presence = (game: string): Presence =>
    ({
      activities: [{ type: ActivityType.Playing, name: game }],
    }) as unknown as Presence;
  const member = (game: string): GuildMember =>
    ({
      id: 'u1',
      user: { bot: false },
      presence: presence(game),
    }) as unknown as GuildMember;

  function ctxFor(): { ctx: JoinHandlerCtx; detect: jest.Mock } {
    const detect = jest.fn().mockResolvedValue({ gameId: 99, gameName: 'x' });
    const svc = {
      getActiveBindingEventGameId: jest.fn().mockReturnValue(null),
      getActiveState: jest.fn(),
    };
    const ctx = {
      deps: { adHocEventService: svc },
      presenceDetector: { detectGameForMember: detect },
      resolveAllBindings: jest.fn().mockResolvedValue([bg3Monitor]),
    } as unknown as JoinHandlerCtx;
    return { ctx, detect };
  }

  it('an unchanged Playing game triggers no game detection or join', async () => {
    const { ctx, detect } = ctxFor();
    const gm = member(BG3.gameName);
    await handlePresenceUpdate(ctx, 'ch', gm, presence(BG3.gameName));
    expect(detect).not.toHaveBeenCalled();
  });

  it('a changed Playing game is re-detected against the monitor', async () => {
    const { ctx, detect } = ctxFor();
    const gm = member(BG3.gameName);
    await handlePresenceUpdate(ctx, 'ch', gm, presence(VALHEIM.gameName));
    expect(detect).toHaveBeenCalledTimes(1);
  });
});
