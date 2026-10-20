/**
 * ROK-1431 §2.6 — hook-site guards: the static `safeTouch`, the event
 * created/updated listener, and the standalone-poll create fan-out.
 */
import { Test } from '@nestjs/testing';
import { GameActivityNudge } from './channel-lifecycle.nudge';
import {
  ChannelLifecycleNudgeListener,
  readLifecycleGameId,
} from './channel-lifecycle.nudge.listener';
import { fireCreateFanout } from '../../lineups/standalone-poll/standalone-poll-create-fanout.helpers';

function throwingNudge(): { touch: jest.Mock } {
  return {
    touch: jest.fn(() => {
      throw new Error('boom');
    }),
  };
}

describe('GameActivityNudge.safeTouch', () => {
  it('forwards the game id to the producer', () => {
    const nudge = { touch: jest.fn() };
    GameActivityNudge.safeTouch(nudge, 7);
    expect(nudge.touch).toHaveBeenCalledWith(7);
  });

  it('contains a synchronous throw and tolerates no producer', () => {
    expect(() => GameActivityNudge.safeTouch(throwingNudge(), 7)).not.toThrow();
    expect(() => GameActivityNudge.safeTouch(undefined, 7)).not.toThrow();
  });
});

describe('readLifecycleGameId', () => {
  it.each([
    [{ gameId: 4 }, 4],
    [{ gameId: null }, null],
    [{ eventId: 1 }, null],
    [null, null],
  ])('reads %p → %p', (payload, expected) => {
    expect(readLifecycleGameId(payload)).toBe(expected);
  });
});

describe('ChannelLifecycleNudgeListener', () => {
  async function build(nudge: {
    touch: jest.Mock;
  }): Promise<ChannelLifecycleNudgeListener> {
    const module = await Test.createTestingModule({
      providers: [
        ChannelLifecycleNudgeListener,
        { provide: GameActivityNudge, useValue: nudge },
      ],
    }).compile();
    return module.get(ChannelLifecycleNudgeListener);
  }

  it('nudges the game on event created and updated (reschedule)', async () => {
    const nudge = { touch: jest.fn() };
    const listener = await build(nudge);
    listener.handleEventCreated({ eventId: 1, gameId: 3 });
    listener.handleEventUpdated({ eventId: 1, gameId: 9 });
    expect(nudge.touch.mock.calls).toEqual([[3], [9]]);
  });

  it('never throws into the emitter when touch throws', async () => {
    const listener = await build(throwingNudge());
    expect(() => listener.handleEventCreated({ gameId: 3 })).not.toThrow();
    expect(() => listener.handleEventUpdated({ gameId: 3 })).not.toThrow();
  });
});

describe('standalone poll create fan-out nudge', () => {
  const game = { id: 12, name: 'Valheim', coverUrl: null };
  const ids = { lineupId: 1, matchId: 2, creatorId: 3 };
  function deps(nudge: { touch: jest.Mock }) {
    return {
      notifications: {
        notifyInterestedUsers: jest.fn().mockResolvedValue(undefined),
        notifyPickedMembers: jest.fn().mockResolvedValue(undefined),
      },
      pollEmbed: { firePostInitialEmbed: jest.fn() },
      nudge,
    };
  }

  it('touches the poll game and still fans out when touch throws', () => {
    const ok = deps({ touch: jest.fn() });
    fireCreateFanout(ok, game, ids, { gameId: 12 }, [], 'public');
    expect(ok.nudge.touch).toHaveBeenCalledWith(12);
    const bad = deps(throwingNudge());
    expect(() =>
      fireCreateFanout(bad, game, ids, { gameId: 12 }, [], 'public'),
    ).not.toThrow();
    expect(bad.pollEmbed.firePostInitialEmbed).toHaveBeenCalled();
  });
});
