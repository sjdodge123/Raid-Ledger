/**
 * ROK-2272 S5a — the admin DTO mapping (pure).
 */
import type { BoundForum } from './event-planning-forum.queries';
import { toEventPlanningForumSettings } from './event-planning-forum.admin';

const A: BoundForum = {
  forumId: 1,
  channelId: '100000000000000001',
  managed: true,
  webhookId: null,
};
const B: BoundForum = {
  forumId: 2,
  channelId: '100000000000000002',
  managed: false,
  webhookId: 'w',
};

describe('toEventPlanningForumSettings', () => {
  it('maps candidates with live names and the resolved channel', () => {
    const dto = toEventPlanningForumSettings(
      B.channelId,
      { forum: B, candidates: [A, B], warning: null },
      (id) => (id === A.channelId ? 'event-planning' : 'raids'),
    );
    expect(dto).toEqual({
      channelId: B.channelId,
      candidates: [
        { channelId: A.channelId, name: 'event-planning', managed: true },
        { channelId: B.channelId, name: 'raids', managed: false },
      ],
      resolvedChannelId: B.channelId,
    });
    expect(dto).not.toHaveProperty('warning');
  });

  it('labels an unreadable channel with its id and carries the warning', () => {
    const dto = toEventPlanningForumSettings(
      null,
      { forum: null, candidates: [A, B], warning: 'ambiguous' },
      () => undefined,
    );
    expect(dto.candidates.map((c) => c.name)).toEqual([
      A.channelId,
      B.channelId,
    ]);
    expect(dto.resolvedChannelId).toBeNull();
    expect(dto.warning).toBe('ambiguous');
  });
});
