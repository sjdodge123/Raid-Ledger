/**
 * ROK-2143 M2/M4 — prerequisites from `requirements.quests`. The fixture is
 * the verbatim `requirements` of quest 4132, the only live quest (run 3,
 * 2026-11-09) with a quest requirement.
 */
import { parseBlizzardQuest } from './blizzard-quest.parse';
import {
  extractPrerequisiteIds,
  listPrerequisiteIds,
  listPrerequisiteRefs,
  pickPrevQuestId,
} from './blizzard-quest.prerequisites';
import { requirementFields } from './blizzard-quest.requirements';

const NS = 'namespace=static-1.60.1_70399-forever-us';
const QUEST_4132_REQUIREMENTS: unknown = JSON.parse(
  `{"quests":{"operator":{"name":"And","type":"AND"},"conditions":[{"operator":{"name":"And","type":"AND"},"conditions":[{"target":{"id":4081,"key":{"href":"https://us.api.blizzard.com/data/wow/quest/4081?${NS}"},"name":"KILL ON SIGHT: Dark Iron Dwarves"}},{"target":{"id":4082,"key":{"href":"https://us.api.blizzard.com/data/wow/quest/4082?${NS}"},"name":"KILL ON SIGHT: High Ranking Dark Iron Officials"}}]},{"target":{"id":4121,"key":{"href":"https://us.api.blizzard.com/data/wow/quest/4121?${NS}"},"name":"Precarious Predicament"}}]}}`,
);

const target = (id: number) => ({ target: { id, name: `q${id}` } });

describe('prerequisites — live quest 4132 shape', () => {
  it('reads every conditions[].target.id, nested groups included', () => {
    expect(listPrerequisiteIds(QUEST_4132_REQUIREMENTS, 4132)).toEqual([
      4081, 4082, 4121,
    ]);
    expect(listPrerequisiteRefs(QUEST_4132_REQUIREMENTS, 4132)).toEqual([
      { id: 4081, depth: 2 },
      { id: 4082, depth: 2 },
      { id: 4121, depth: 1 },
    ]);
  });

  it('gives the crawl all three ids, sorted', () => {
    expect(extractPrerequisiteIds(QUEST_4132_REQUIREMENTS, 4132)).toEqual([
      4081, 4082, 4121,
    ]);
    const parsed = parseBlizzardQuest({
      id: 4132,
      title: 'Operation: Death to Angerforge',
      requirements: QUEST_4132_REQUIREMENTS,
    });
    expect(parsed?.prerequisiteIds).toEqual([4081, 4082, 4121]);
  });

  it('sets prevQuestId to the direct target 4121, not a nested one', () => {
    expect(requirementFields(QUEST_4132_REQUIREMENTS, 4132).prevQuestId).toBe(
      4121,
    );
  });
});

describe('prerequisites — operators (M4)', () => {
  it.each([
    ['OR', { name: 'Or', type: 'OR' }],
    ['a negation', { name: 'Not', type: 'NOT' }],
    ['an operator without a type', { id: 2 }],
    ['an OR string', 'OR'],
  ])('names no prerequisite under %s', (_label, operator) => {
    const req = { quests: { operator, conditions: [target(10), target(11)] } };
    expect(listPrerequisiteIds(req)).toEqual([]);
    expect(requirementFields(req).prevQuestId).toBeNull();
  });

  it('skips an OR group nested in an AND group but keeps its AND siblings', () => {
    const req = {
      quests: {
        operator: { type: 'AND' },
        conditions: [
          { operator: { type: 'OR' }, conditions: [target(20), target(21)] },
          target(22),
        ],
      },
    };
    expect(listPrerequisiteIds(req)).toEqual([22]);
  });

  it('treats a group with no operator as a plain (AND) list', () => {
    expect(
      listPrerequisiteIds({ quests: { conditions: [target(5), { id: 6 }] } }),
    ).toEqual([5, 6]);
  });
});

describe('pickPrevQuestId', () => {
  it('prefers the shallowest group, then the highest id', () => {
    expect(
      pickPrevQuestId([
        { id: 900, depth: 2 },
        { id: 12, depth: 1 },
        { id: 40, depth: 1 },
      ]),
    ).toBe(40);
  });

  it('is null without prerequisites', () => {
    expect(pickPrevQuestId([])).toBeNull();
  });

  it('keeps the shallowest occurrence of a repeated id and drops the quest itself', () => {
    const req = {
      quests: {
        operator: { type: 'AND' },
        conditions: [
          { operator: { type: 'AND' }, conditions: [target(7), target(9)] },
          target(7),
        ],
      },
    };
    expect(listPrerequisiteRefs(req, 9)).toEqual([{ id: 7, depth: 1 }]);
  });

  it('stops at the nesting cap without throwing', () => {
    let deep: unknown = target(1);
    for (let i = 0; i < 20; i++) deep = { conditions: [deep] };
    expect(listPrerequisiteIds({ quests: deep })).toEqual([]);
  });

  it('names no prerequisite for a 10k-deep nested array (review r4 MINOR 1)', () => {
    let deep: unknown = target(1);
    for (let i = 0; i < 10_000; i++) deep = [deep];
    let refs: unknown = 'threw';
    expect(() => {
      refs = listPrerequisiteRefs({ quests: deep });
    }).not.toThrow();
    expect(refs).toEqual([]);
  });

  it('names no prerequisite for a 10k-deep target chain (review r4 MINOR 1)', () => {
    let deep: unknown = { id: 1 };
    for (let i = 0; i < 10_000; i++) deep = { target: deep };
    let refs: unknown = 'threw';
    expect(() => {
      refs = listPrerequisiteRefs({ quests: deep });
    }).not.toThrow();
    expect(refs).toEqual([]);
  });
});
