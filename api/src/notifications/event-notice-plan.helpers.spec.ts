import {
  planEventNotices,
  type EventNoticePlanInput,
} from './event-notice-plan.helpers';

function plan(over: Partial<EventNoticePlanInput>) {
  return planEventNotices({
    affinityIds: [],
    groupIds: [],
    groupMuted: new Set(),
    groupTypeOff: new Set(),
    ...over,
  });
}

describe('planEventNotices (ROK-1832 D5)', () => {
  it('gives a user only in affinity the game copy', () => {
    expect(plan({ affinityIds: [1] })).toEqual([
      { userId: 1, type: 'subscribed_game' },
    ]);
  });

  it('gives a user only in the group the group copy', () => {
    expect(plan({ groupIds: [2] })).toEqual([
      { userId: 2, type: 'hub_event_tagged' },
    ]);
  });

  it('gives a user in both exactly one notice, the group copy', () => {
    expect(plan({ affinityIds: [3], groupIds: [3] })).toEqual([
      { userId: 3, type: 'hub_event_tagged' },
    ]);
  });

  it('falls back to the game copy when the user muted the group', () => {
    expect(
      plan({ affinityIds: [4], groupIds: [4], groupMuted: new Set([4]) }),
    ).toEqual([{ userId: 4, type: 'subscribed_game' }]);
  });

  it('falls back to the game copy when both group channels are off', () => {
    expect(
      plan({ affinityIds: [5], groupIds: [5], groupTypeOff: new Set([5]) }),
    ).toEqual([{ userId: 5, type: 'subscribed_game' }]);
  });

  it('sends nothing to a group-only user who muted the group', () => {
    expect(plan({ groupIds: [6], groupMuted: new Set([6]) })).toEqual([]);
  });

  it('never notices a user twice across many ids', () => {
    const out = plan({ affinityIds: [1, 2, 3], groupIds: [2, 3, 4] });
    expect(out.map((n) => n.userId).sort()).toEqual([1, 2, 3, 4]);
  });
});
