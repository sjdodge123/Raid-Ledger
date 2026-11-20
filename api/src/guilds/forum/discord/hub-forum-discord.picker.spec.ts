/**
 * ROK-2258 — the tag budget the picker and preflight show: slots left once
 * every bound hub still without a tag gets one (0 = no hub can join). A lone
 * hub tagged at bind time reserves nothing more; the Event tag is
 * best-effort (skipped when the forum is full), so it is never reserved.
 */
import type { ForumInfo } from './hub-forum-discord.gateway';
import {
  freeSlots,
  pickShared,
  sharedCandidates,
} from './hub-forum-discord.picker';

function forum(id: string, name: string): ForumInfo {
  return { id, name, tags: [], missing: [], canManage: true, isPublic: true, requireTag: false };
}

describe('freeSlots', () => {
  it('an empty forum with no hubs offers all 20', () => {
    expect(freeSlots(0, 0)).toBe(20);
  });

  it('a lone hub already tagged (hub + Event tags) reserves nothing more', () => {
    expect(freeSlots(2, 0)).toBe(18);
  });

  it('a lone untagged hub (decor never ran) reserves its own tag', () => {
    expect(freeSlots(3, 1)).toBe(16);
  });

  it('every untagged hub reserves a slot, not only a lone one', () => {
    expect(freeSlots(5, 2)).toBe(13);
  });

  it('a forum full once the untagged hubs are tagged offers 0', () => {
    expect(freeSlots(19, 1)).toBe(0);
    expect(freeSlots(20, 0)).toBe(0);
    expect(freeSlots(20, 2)).toBe(0);
  });
});

describe('ROK-2272 shared forum by name (default event-planning, legacy hub-forums)', () => {
  it('treats a legacy #hub-forums as the shared forum', () => {
    const legacy = forum('c1', 'hub-forums');
    expect(sharedCandidates([forum('c0', 'general'), legacy])).toEqual([legacy]);
  });

  it('lists #event-planning before a legacy #hub-forums', () => {
    const legacy = forum('c1', 'hub-forums');
    const current = forum('c2', 'event-planning');
    expect(sharedCandidates([legacy, current]).map((f) => f.id)).toEqual(['c2', 'c1']);
  });

  it('ignores forums with any other name', () => {
    expect(sharedCandidates([forum('c3', 'hub-forum'), forum('c4', 'Event Planning')])).toEqual([]);
  });

  it('prefers the bot-made forum, else the default-named one', () => {
    const named = [forum('c2', 'event-planning'), forum('c1', 'hub-forums')];
    expect(pickShared(named, new Set(['c1']))?.id).toBe('c1');
    expect(pickShared(named, new Set())?.id).toBe('c2');
    expect(pickShared([], new Set())).toBeNull();
  });
});
