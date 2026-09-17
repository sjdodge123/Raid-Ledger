/**
 * ROK-1541 — the pure half of "LFG group members are members of the post's
 * thread": which users a membership change moves, which Discord ids are real,
 * and how a batch of adds/removes fails (once, quietly).
 */
import {
  applyThreadMembers,
  linkedDiscordIds,
  planMembershipChange,
  THREAD_MEMBER_CAP,
  type ThreadMemberTarget,
} from './lfg-board-thread-members.helpers';

function discordError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

function target(over: Partial<ThreadMemberTarget> = {}): ThreadMemberTarget {
  return {
    id: 'thread-1',
    memberCount: 2,
    members: {
      add: jest.fn(() => Promise.resolve('ok')),
      remove: jest.fn(() => Promise.resolve('ok')),
    },
    ...over,
  };
}

describe('planMembershipChange', () => {
  it('adds exactly the joiners on a join, never the rest of the roster', () => {
    // User 1 manually left the thread; user 2 is the one who just joined.
    const plan = planMembershipChange('joined', [2], new Set([1, 2]));
    expect(plan).toEqual({ kind: 'add', userIds: [2] });
  });

  it('removes a withdrawer who is no longer in the roster', () => {
    const plan = planMembershipChange('withdrawn', [3], new Set([1, 2]));
    expect(plan).toEqual({ kind: 'remove', userIds: [3] });
  });

  it('keeps a withdrawer who is somehow still in the roster', () => {
    expect(planMembershipChange('withdrawn', [2], new Set([1, 2]))).toBeNull();
  });

  it.each(['bumped', 'converted', 'expired', 'playing'] as const)(
    'moves nobody on %s',
    (reason) => {
      expect(planMembershipChange(reason, [2], new Set([1]))).toBeNull();
    },
  );

  it('moves nobody when the change names no users', () => {
    expect(planMembershipChange('joined', [], new Set([1]))).toBeNull();
  });
});

describe('linkedDiscordIds', () => {
  it('keeps real snowflakes only, de-duplicated', () => {
    expect(
      linkedDiscordIds([
        { discordId: '111' },
        { discordId: null },
        { discordId: 'local:admin' },
        { discordId: 'unlinked:222' },
        { discordId: '111' },
        { discordId: '333' },
      ]),
    ).toEqual(['111', '333']);
  });
});

describe('applyThreadMembers', () => {
  it('adds every id', async () => {
    const t = target();
    const warn = jest.fn();
    await applyThreadMembers(t, 'add', ['1', '2'], warn);
    expect(t.members.add).toHaveBeenCalledWith('1');
    expect(t.members.add).toHaveBeenCalledWith('2');
    expect(warn).not.toHaveBeenCalled();
  });

  it('removes every id, and a "not a member" answer is not a failure', async () => {
    const t = target({
      members: {
        add: jest.fn(),
        remove: jest.fn(() =>
          Promise.reject(discordError('Unknown Member', 10007)),
        ),
      },
    });
    const warn = jest.fn();
    await applyThreadMembers(t, 'remove', ['1'], warn);
    expect(t.members.remove).toHaveBeenCalledWith('1');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs ONE warning for many failures and never throws', async () => {
    const t = target({
      members: {
        add: jest.fn(() => Promise.reject(new Error('Service Unavailable'))),
        remove: jest.fn(),
      },
    });
    const warn = jest.fn();
    await expect(
      applyThreadMembers(t, 'add', ['1', '2', '3'], warn),
    ).resolves.toBeUndefined();
    expect(t.members.add).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('3 of 3');
  });

  it('stops at the first permanent refusal (Missing Access / thread gone)', async () => {
    const t = target({
      members: {
        add: jest.fn(() => Promise.reject(discordError('Missing Access', 50001))),
        remove: jest.fn(),
      },
    });
    const warn = jest.fn();
    await applyThreadMembers(t, 'add', ['1', '2', '3'], warn);
    expect(t.members.add).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('respects the member cap without throwing', async () => {
    const t = target({ memberCount: THREAD_MEMBER_CAP - 1 });
    const warn = jest.fn();
    await applyThreadMembers(t, 'add', ['1', '2', '3'], warn);
    expect(t.members.add).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('1,000');
  });

  it('does nothing for an empty batch', async () => {
    const t = target();
    const warn = jest.fn();
    await applyThreadMembers(t, 'add', [], warn);
    expect(t.members.add).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
