/**
 * ROK-2258 — the pure decisions behind dressing a bound Discord forum:
 * which tags to create or reuse, whether to set the 👍 default reaction,
 * whether to turn on Require tags, and which tags an event post carries.
 */
import {
  EVENT_TAG_NAME,
  LINEUP_TAG_NAME,
  POLL_TAG_NAME,
  RESERVED_TAG_NAMES,
  isReservedTagName,
  findTagId,
  planTagCreates,
  postTagIds,
  shouldRequireTags,
  shouldSetDefaultReaction,
} from './hub-forum-discord-decor';

const tags = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${String(i)}`,
    name: `mod ${String(i)}`,
  }));

describe('ROK-2258 planTagCreates', () => {
  it('creates the hub and Event tags a bare forum lacks', () => {
    expect(planTagCreates([], ['Night Owls', EVENT_TAG_NAME])).toEqual({
      create: ['Night Owls', 'Event'],
      skipped: [],
    });
  });

  it('reuses an existing tag by name, case-insensitively', () => {
    const existing = [
      { id: 'e', name: 'EVENT' },
      { id: 'n', name: 'night owls' },
    ];
    expect(planTagCreates(existing, ['Night Owls', 'Event'])).toEqual({
      create: [],
      skipped: [],
    });
  });

  it('skips what does not fit under the 20-tag cap instead of throwing', () => {
    expect(planTagCreates(tags(19), ['Night Owls', 'Event'])).toEqual({
      create: ['Night Owls'],
      skipped: ['Event'],
    });
    expect(planTagCreates(tags(20), ['Event'])).toEqual({
      create: [],
      skipped: ['Event'],
    });
  });

  it('never plans the same name twice', () => {
    expect(planTagCreates([], ['Event', 'event']).create).toEqual(['Event']);
  });
});

describe('ROK-2258 findTagId', () => {
  it('matches by name case-insensitively and answers null when absent', () => {
    const existing = [{ id: 'e', name: 'Event' }];
    expect(findTagId(existing, 'event')).toBe('e');
    expect(findTagId(existing, 'Raid')).toBeNull();
  });
});

describe('ROK-2258 shouldSetDefaultReaction', () => {
  it('sets 👍 only while the forum has no default reaction', () => {
    expect(shouldSetDefaultReaction(null)).toBe(true);
    expect(shouldSetDefaultReaction({ id: null, name: null })).toBe(true);
  });

  it('never overwrites a moderator-chosen reaction', () => {
    expect(shouldSetDefaultReaction({ id: null, name: '🔥' })).toBe(false);
    expect(shouldSetDefaultReaction({ id: '123', name: null })).toBe(false);
  });
});

describe('ROK-2258 shouldRequireTags', () => {
  it('never for a forum only one hub uses', () => {
    expect(shouldRequireTags(0, false)).toBe(false);
    expect(shouldRequireTags(1, false)).toBe(false);
  });

  it('once more than one hub shares it, unless already on', () => {
    expect(shouldRequireTags(2, false)).toBe(true);
    expect(shouldRequireTags(3, true)).toBe(false);
  });
});

describe('ROK-2258 postTagIds', () => {
  const forumTags = [{ id: 'e', name: 'event' }];

  it('adds the Event tag to an event post after the hub tag', () => {
    expect(postTagIds(['h'], true, forumTags)).toEqual(['h', 'e']);
  });

  it('leaves a plain post with only the hub tag', () => {
    expect(postTagIds(['h'], false, forumTags)).toEqual(['h']);
    expect(postTagIds([], false, forumTags)).toEqual([]);
  });

  it('posts an event without the Event tag when the forum has none', () => {
    expect(postTagIds([], true, [])).toEqual([]);
  });

  it("never repeats a tag and keeps to Discord's 5 per post", () => {
    expect(postTagIds(['e'], true, forumTags)).toEqual(['e']);
    const five = ['a', 'b', 'c', 'd', 'f'];
    expect(postTagIds(five, true, forumTags)).toEqual(five);
  });
});

describe('ROK-2272 §3.3 Poll + Lineup kind tags', () => {
  it('reserves Event, Poll and Lineup (any case, trimmed)', () => {
    expect(RESERVED_TAG_NAMES).toEqual(['Event', 'Poll', 'Lineup']);
    expect(isReservedTagName(' poll ')).toBe(true);
    expect(isReservedTagName('LINEUP')).toBe(true);
    expect(isReservedTagName('Polls')).toBe(false);
  });

  it('creates a missing Poll tag on demand and reuses an existing Lineup', () => {
    const existing = [{ id: 'l', name: 'lineup' }];
    expect(planTagCreates(existing, [POLL_TAG_NAME, LINEUP_TAG_NAME])).toEqual({
      create: ['Poll'],
      skipped: [],
    });
    expect(findTagId(existing, LINEUP_TAG_NAME)).toBe('l');
  });

  it('skips a kind tag that does not fit under the 20-tag cap', () => {
    expect(planTagCreates(tags(20), [POLL_TAG_NAME])).toEqual({
      create: [],
      skipped: ['Poll'],
    });
  });
});
