/**
 * ROK-2260 ruling 3 (review M1) — removing cancelled signups from an event's
 * Discord post: an auto-archived post is reopened first, and only the ids
 * actually out of the post are reported (failures retry next flush).
 */
import {
  removePostMembers,
  type PostMemberTarget,
} from './hub-forum-discord-post-members';

function post(over: Partial<PostMemberTarget> = {}) {
  const state = { archived: over.archived ?? false };
  const calls: string[] = [];
  const remove = jest.fn((id: string) => {
    calls.push(`remove:${id}`);
    if (state.archived) return Promise.reject(new Error('Thread is archived'));
    return Promise.resolve();
  });
  const thread: PostMemberTarget = {
    id: 'dpost',
    archived: state.archived,
    locked: over.locked ?? false,
    setArchived: jest.fn((archived: boolean) => {
      calls.push(`archived:${archived}`);
      state.archived = archived;
      return Promise.resolve();
    }),
    members: { remove },
  };
  return { thread, calls, remove };
}

describe('ROK-2260 removePostMembers', () => {
  it('reopens an auto-archived post, removes, then archives it again', async () => {
    const t = post({ archived: true });
    const warn = jest.fn();
    expect(await removePostMembers(t.thread, ['1', '2'], warn)).toEqual([
      '1',
      '2',
    ]);
    expect(t.calls).toEqual([
      'archived:false',
      'remove:1',
      'remove:2',
      'archived:true',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves a live post as it is', async () => {
    const t = post();
    expect(await removePostMembers(t.thread, ['1'], jest.fn())).toEqual(['1']);
    expect(t.calls).toEqual(['remove:1']);
  });

  it('never reopens a locked post; its failed removals are not reported done', async () => {
    const t = post({ archived: true, locked: true });
    const warn = jest.fn();
    expect(await removePostMembers(t.thread, ['1'], warn)).toEqual([]);
    expect(t.thread.setArchived).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('1 of 1 cancelled signup(s) from event post'),
    );
  });

  it('counts "not a member" as done and a transient failure as not done', async () => {
    const t = post();
    t.remove
      .mockRejectedValueOnce(
        Object.assign(new Error('Unknown Member'), { code: 10007 }),
      )
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce(undefined);
    const warn = jest.fn();
    expect(await removePostMembers(t.thread, ['1', '2', '3'], warn)).toEqual([
      '1',
      '3',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).not.toContain('LFG');
  });

  it('removes nobody (none done) when Discord refuses to reopen the post', async () => {
    const t = post({ archived: true });
    jest
      .mocked(t.thread.setArchived)
      .mockRejectedValueOnce(new Error('Missing Permissions'));
    const warn = jest.fn();
    expect(await removePostMembers(t.thread, ['1'], warn)).toEqual([]);
    expect(t.remove).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reopen event post dpost'),
    );
  });
});
