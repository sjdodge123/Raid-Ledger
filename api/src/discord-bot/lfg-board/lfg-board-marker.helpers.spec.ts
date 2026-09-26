/**
 * ROK-1522 — the board mark names its owning bot, so one guild can host
 * several Raid Ledger instances without one adopting (and a smoke run then
 * deleting) another's forum.
 */
import {
  LFG_BOARD_TOPIC,
  LFG_BOARD_TOPIC_SENTINEL,
} from './lfg-board-permissions.helpers';
import {
  adoptableMarked,
  boardTopic,
  markOwner,
  ownedSentinel,
  topicMarkedFor,
} from './lfg-board-marker.helpers';

const ME = '111';
const OTHER = '222';

describe('markOwner', () => {
  it.each([
    [boardTopic(ME), 'own'],
    [boardTopic(OTHER), 'foreign'],
    [LFG_BOARD_TOPIC, 'legacy'],
    [`rules\n\n${LFG_BOARD_TOPIC_SENTINEL} trailing`, 'legacy'],
    ['Looking for group chat', 'none'],
    [null, 'none'],
  ])('markOwner(%p) === %p', (topic, expected) => {
    expect(markOwner(topic, ME)).toBe(expected);
  });

  it('treats every tagged mark as foreign when our id is unknown', () => {
    expect(markOwner(boardTopic(ME), null)).toBe('foreign');
  });
});

describe('topicMarkedFor', () => {
  it('upgrades a legacy mark in place, keeping operator text', () => {
    const next = topicMarkedFor(`Rules.\n\n${LFG_BOARD_TOPIC_SENTINEL}`, ME);
    expect(next).toBe(`Rules.\n\n${ownedSentinel(ME)}`);
  });

  it("leaves another bot's mark and our own untouched", () => {
    expect(topicMarkedFor(boardTopic(OTHER), ME)).toBe(boardTopic(OTHER));
    expect(topicMarkedFor(boardTopic(ME), ME)).toBe(boardTopic(ME));
  });

  it('appends our mark to unmarked operator text, or writes the full topic', () => {
    expect(topicMarkedFor('Rules.', ME)).toBe(`Rules.\n\n${ownedSentinel(ME)}`);
    expect(topicMarkedFor(null, ME)).toBe(boardTopic(ME));
  });
});

describe('adoptableMarked', () => {
  const own = { id: 'own', topic: boardTopic(ME) };
  const legacy = { id: 'legacy', topic: LFG_BOARD_TOPIC };
  const foreign = { id: 'foreign', topic: boardTopic(OTHER) };

  it('never offers a forum another bot has marked', () => {
    expect(adoptableMarked([foreign], ME)).toEqual([]);
  });

  it('prefers our own marks and falls back to legacy only when none exist', () => {
    expect(adoptableMarked([legacy, foreign, own], ME)).toEqual([own]);
    expect(adoptableMarked([legacy, foreign], ME)).toEqual([legacy]);
  });
});
