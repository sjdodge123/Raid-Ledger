/**
 * ROK-1805 (ROK-1801 Codex r4 P2s) — a lobby member moved onto another game's
 * group leaves the old event and closes the old game's voice session first.
 */
import {
  retrackVoiceGame,
  switchLobbyMemberGame,
} from './voice-lobby-switch.helpers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import type { ResolvedBinding } from './voice-state.helpers';

const LOBBY = { bindingId: 'lobby' } as unknown as ResolvedBinding;
const RUST = { gameId: 1, gameName: 'Rust' };
const VALHEIM = { gameId: 2, gameName: 'Valheim' };

function depsWith(
  targetMembers: string[] | null,
  tracked: typeof RUST | null,
): { deps: VoiceHandlerDeps; order: string[] } {
  const order: string[] = [];
  const tracker = new Map<string, { gameName: string; userId: number }>();
  if (tracked) tracker.set('a', { gameName: tracked.gameName, userId: 7 });
  const state = targetMembers ? { memberSet: new Set(targetMembers) } : null;
  const deps = {
    voiceGameTracker: tracker,
    adHocEventService: {
      getActiveState: jest.fn(() => state),
      handleVoiceLeave: jest.fn((_b: string, id: string) => {
        order.push(`leave:${id}`);
        return Promise.resolve();
      }),
    },
    gameActivityService: {
      bufferStop: jest.fn((_u: number, game: string) => {
        order.push(`stop:${game}`);
      }),
      bufferStart: jest.fn((_u: number, game: string) => {
        order.push(`start:${game}`);
      }),
    },
  } as unknown as VoiceHandlerDeps;
  return { deps, order };
}

describe('switchLobbyMemberGame (ROK-1805)', () => {
  it('leaves the old game event and stops its voice session before starting the new game', async () => {
    const { deps, order } = depsWith(null, RUST);
    await switchLobbyMemberGame(deps, LOBBY, 'a', VALHEIM, 7);
    expect(order).toEqual(['leave:a', 'stop:Rust', 'start:Valheim']);
    expect(deps.voiceGameTracker.get('a')?.gameName).toBe('Valheim');
  });

  it('a member already in the target game event is not made to leave it', async () => {
    const { deps, order } = depsWith(['a'], null);
    await switchLobbyMemberGame(deps, LOBBY, 'a', VALHEIM, 7);
    expect(order).toEqual(['start:Valheim']);
  });
});

describe('retrackVoiceGame (ROK-1805)', () => {
  it('keeps the open session when the member is already tracked on that game', () => {
    const { deps, order } = depsWith(null, VALHEIM);
    retrackVoiceGame(deps, 'a', VALHEIM, 7);
    expect(order).not.toContain('stop:Valheim');
  });
});
