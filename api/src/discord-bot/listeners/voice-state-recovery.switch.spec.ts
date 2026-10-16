/**
 * ROK-1805 (ROK-1801 Codex r4 P2 1) — a delayed lobby spawn that fires after a
 * member switched games (server presence) must not leave them enrolled in the
 * old game's event too, nor keep the old game's voice session open.
 */
import type { VoiceBasedChannel } from 'discord.js';
import { addDetectedMembers } from './voice-state-recovery.handlers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import type { ResolvedBinding } from './voice-state.helpers';

const LOBBY = {
  bindingId: 'lobby',
  gameId: null,
  bindingPurpose: 'general-lobby',
} as unknown as ResolvedBinding;
const VALHEIM = { gameId: 2, gameName: 'Valheim', memberIds: ['a'] };

function harness(): { deps: VoiceHandlerDeps; order: string[] } {
  const order: string[] = [];
  const tracker = new Map([['a', { gameName: 'Rust', userId: 7 }]]);
  const deps = {
    voiceGameTracker: tracker,
    usersService: { findByDiscordId: () => Promise.resolve({ id: 7 }) },
    adHocEventService: {
      getActiveState: () => undefined,
      handleVoiceLeave: (_b: string, id: string) => {
        order.push(`leave:${id}`);
        return Promise.resolve();
      },
      handleVoiceJoin: (_b: string, mi: { discordUserId: string }) => {
        order.push(`join:${mi.discordUserId}`);
        return Promise.resolve(true);
      },
    },
    gameActivityService: {
      bufferStop: (_u: number, game: string) => order.push(`stop:${game}`),
      bufferStart: (_u: number, game: string) => order.push(`start:${game}`),
    },
  } as unknown as VoiceHandlerDeps;
  return { deps, order };
}

describe('addDetectedMembers — delayed spawn after a game switch (ROK-1805)', () => {
  it('leaves the old game event and closes its voice session before joining the new event', async () => {
    const { deps, order } = harness();
    const channel = {
      members: new Map([['a', { id: 'a', user: { bot: false } }]]),
    } as unknown as VoiceBasedChannel;
    await addDetectedMembers(deps, channel, [VALHEIM], LOBBY, 'vc');
    expect(order).toEqual(['leave:a', 'stop:Rust', 'start:Valheim', 'join:a']);
  });
});
