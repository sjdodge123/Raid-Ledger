import { LINEUP_LIFECYCLE_EVENTS } from '../../../lineups/lineup-events.constants';
import type { HubForumDiscordClosingLines } from './hub-forum-discord-closing-lines.service';
import {
  HubForumDiscordSubjectListener,
  isLineupAbort,
  isLineupReopen,
} from './hub-forum-discord-subject.listener';

function build() {
  const closing = {
    firstVote: jest.fn().mockResolvedValue(undefined),
    pollLockedIn: jest.fn().mockResolvedValue(undefined),
    pollCancelled: jest.fn().mockResolvedValue(undefined),
    lineupDecided: jest.fn().mockResolvedValue(undefined),
    lineupAborted: jest.fn().mockResolvedValue(undefined),
    pollReopened: jest.fn().mockResolvedValue(undefined),
    lineupReopened: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new HubForumDiscordSubjectListener(
    closing as unknown as HubForumDiscordClosingLines,
  );
  return { closing, listener };
}

describe('HubForumDiscordSubjectListener (ROK-2272 S8)', () => {
  it('routes each emit to its closing-lines call', async () => {
    const { closing, listener } = build();
    await listener.onPollVoted({
      matchId: 1,
      lineupId: 2,
      userId: 3,
      stance: null,
    });
    await listener.onPollLockedIn({ matchId: 1, eventId: 9 });
    await listener.onPollCancelled({ matchId: 1, lineupId: 2, reason: 'r' });
    await listener.onLineupDecided({ lineupId: 2 });
    await listener.onLineupStatusChanged({
      lineupId: 2,
      from: 'voting',
      to: 'archived',
      standalone: false,
    });
    expect(closing.firstVote).toHaveBeenCalledWith(1);
    expect(closing.pollLockedIn).toHaveBeenCalledWith(1, 9);
    expect(closing.pollCancelled).toHaveBeenCalledWith(1, 'r');
    expect(closing.lineupDecided).toHaveBeenCalledWith(2);
    expect(closing.lineupAborted).toHaveBeenCalledWith(2);
  });

  it('STATUS_CHANGED: only a non-standalone archive that was not decided aborts', () => {
    const base = { lineupId: 1, standalone: false } as const;
    expect(isLineupAbort({ ...base, from: 'building', to: 'archived' })).toBe(
      true,
    );
    expect(isLineupAbort({ ...base, from: 'decided', to: 'archived' })).toBe(
      false,
    );
    expect(isLineupAbort({ ...base, from: 'voting', to: 'decided' })).toBe(
      false,
    );
    expect(
      isLineupAbort({
        ...base,
        standalone: true,
        from: 'voting',
        to: 'archived',
      }),
    ).toBe(false);
  });

  it('a non-abort status change calls nothing', async () => {
    const { closing, listener } = build();
    await listener.onLineupStatusChanged({
      lineupId: 2,
      from: 'decided',
      to: 'archived',
      standalone: false,
    });
    expect(closing.lineupAborted).not.toHaveBeenCalled();
  });

  it('reopen signals clear the end keys: re-entered scheduling, lineup back to open', async () => {
    const { closing, listener } = build();
    await listener.onPollReopened({ matchId: 7 });
    await listener.onLineupStatusChanged({
      lineupId: 2,
      from: 'decided',
      to: 'voting',
      standalone: false,
    });
    expect(closing.pollReopened).toHaveBeenCalledWith(7);
    expect(closing.lineupReopened).toHaveBeenCalledWith(2);
    expect(closing.lineupAborted).not.toHaveBeenCalled();
  });

  it('isLineupReopen: only decided/archived → an open status, never a carrier', () => {
    const base = { lineupId: 1, standalone: false } as const;
    expect(isLineupReopen({ ...base, from: 'decided', to: 'voting' })).toBe(
      true,
    );
    expect(isLineupReopen({ ...base, from: 'archived', to: 'building' })).toBe(
      true,
    );
    expect(isLineupReopen({ ...base, from: 'decided', to: 'archived' })).toBe(
      false,
    );
    expect(isLineupReopen({ ...base, from: 'voting', to: 'decided' })).toBe(
      false,
    );
    expect(
      isLineupReopen({
        ...base,
        standalone: true,
        from: 'decided',
        to: 'voting',
      }),
    ).toBe(false);
  });

  it('a failing reopen is logged, never thrown', async () => {
    const { closing, listener } = build();
    closing.pollReopened.mockRejectedValue(new Error('boom'));
    closing.lineupReopened.mockRejectedValue(new Error('boom'));
    await expect(
      listener.onPollReopened({ matchId: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      listener.onLineupStatusChanged({
        lineupId: 2,
        from: 'archived',
        to: 'voting',
        standalone: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('never throws into the emitter', async () => {
    const { closing, listener } = build();
    closing.pollLockedIn.mockRejectedValue(new Error('boom'));
    closing.firstVote.mockRejectedValue(new Error('boom'));
    await expect(
      listener.onPollLockedIn({ matchId: 1, eventId: 2 }),
    ).resolves.toBeUndefined();
    await expect(
      listener.onPollVoted({
        matchId: 1,
        lineupId: 2,
        userId: 3,
        stance: null,
      }),
    ).resolves.toBeUndefined();
    expect(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED).toBe(
      'lineup.status-changed',
    );
  });
});
