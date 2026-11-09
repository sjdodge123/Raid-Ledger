import {
  buildClassicItemUrl,
  buildQuestAreaIndexUrl,
  buildQuestAreaUrl,
  buildQuestIndexUrl,
  buildQuestUrl,
  collectRequirementKeyPaths,
  extractPrerequisiteIds,
  parseBlizzardQuest,
  parseQuestAreaQuests,
  parseQuestIndexAreas,
} from './blizzard-quest.parse';

/**
 * Fixtures follow the 2026-11-08 probe's recorded shapes (top-level keys
 * `_links, area, description, id, requirements, rewards, title, type`).
 * The `requirements` contents were NOT recorded by the probe: the shape below
 * is a stand-in until L5 captures real responses.
 */
const key = (path: string) => ({ href: `https://us.api.blizzard.com/${path}` });

const QUEST_1486 = {
  _links: { self: key('data/wow/quest/1486') },
  id: 1486,
  title: 'Deviate Hides',
  area: {
    key: key('data/wow/quest/area/718'),
    name: 'Wailing Caverns',
    id: 718,
  },
  description: 'Bring 20 Deviate Hides to Nalpak.',
  requirements: { min_character_level: 13 },
  rewards: {
    experience: 3100,
    money: { value: 1800, units: { gold: 0, silver: 18, copper: 0 } },
    items: {
      items: [
        {
          id: 1,
          item: {
            key: key('data/wow/item/918'),
            name: 'Deviate Hide Pack',
            id: 918,
          },
        },
      ],
    },
  },
  type: { key: key('data/wow/quest/type/81'), name: 'Dungeon', id: 81 },
};

const REQUIREMENTS_378 = {
  min_character_level: 16,
  faction: { type: 'ALLIANCE', name: 'Alliance' },
  quests: [
    { key: key('data/wow/quest/303'), name: 'The Dark Iron War', id: 303 },
  ],
};

const QUEST_378 = {
  _links: { self: key('data/wow/quest/378') },
  id: 378,
  title: 'The Fury Runs Deep',
  area: { key: key('data/wow/quest/area/717'), name: 'The Stockade', id: 717 },
  description: '…',
  requirements: REQUIREMENTS_378,
  rewards: {
    experience: 5750,
    reputations: [
      {
        reward: {
          key: key('data/wow/reputation-faction/47'),
          name: 'Ironforge',
          id: 47,
        },
        value: 150,
      },
    ],
  },
  type: { name: 'Dungeon', id: 81 },
};

describe('URL builders', () => {
  it('uses the static-forever namespace for quest endpoints', () => {
    expect(buildQuestIndexUrl('us')).toBe(
      'https://us.api.blizzard.com/data/wow/quest/index?namespace=static-forever-us&locale=en_US',
    );
    expect(buildQuestAreaUrl('eu', 717)).toBe(
      'https://eu.api.blizzard.com/data/wow/quest/area/717?namespace=static-forever-eu&locale=en_US',
    );
    expect(buildQuestAreaIndexUrl('us')).toBe(
      'https://us.api.blizzard.com/data/wow/quest/area/index?namespace=static-forever-us&locale=en_US',
    );
    expect(buildQuestUrl('us', 378)).toBe(
      'https://us.api.blizzard.com/data/wow/quest/378?namespace=static-forever-us&locale=en_US',
    );
  });

  it('lower-cases the region', () => {
    expect(buildQuestUrl('KR', 1)).toBe(
      'https://kr.api.blizzard.com/data/wow/quest/1?namespace=static-forever-kr&locale=en_US',
    );
  });

  it('uses static-classic1x for the R8 item probe', () => {
    expect(buildClassicItemUrl('us', 918)).toBe(
      'https://us.api.blizzard.com/data/wow/item/918?namespace=static-classic1x-us&locale=en_US',
    );
  });
});

describe('parseQuestIndexAreas', () => {
  it('reads areas[] and skips off-shape entries', () => {
    const json = {
      _links: { self: key('data/wow/quest/index') },
      areas: [
        { key: key('x'), name: 'The Stockade', id: 717 },
        { name: 'no id' },
        'junk',
        { id: 718, name: { en_US: 'Wailing Caverns' } },
      ],
      categories: [],
      types: [],
    };
    expect(parseQuestIndexAreas(json)).toEqual([
      { id: 717, name: 'The Stockade' },
      { id: 718, name: 'Wailing Caverns' },
    ]);
  });

  it('returns [] for the documented quest/index, whose areas is a link', () => {
    const json = {
      _links: { self: key('data/wow/quest/index') },
      categories: key('data/wow/quest/category/index'),
      areas: key('data/wow/quest/area/index'),
      types: key('data/wow/quest/type/index'),
    };
    expect(parseQuestIndexAreas(json)).toEqual([]);
  });

  it('reads the documented quest/area/index areas[] (key, name, id)', () => {
    const json = {
      _links: { self: key('data/wow/quest/area/index') },
      areas: [
        { key: key('data/wow/quest/area/717'), name: 'The Stockade', id: 717 },
        {
          key: key('data/wow/quest/area/718'),
          name: 'Wailing Caverns',
          id: 718,
        },
      ],
    };
    expect(parseQuestIndexAreas(json)).toEqual([
      { id: 717, name: 'The Stockade' },
      { id: 718, name: 'Wailing Caverns' },
    ]);
  });

  it('returns [] for a non-object or a missing areas key', () => {
    expect(parseQuestIndexAreas(null)).toEqual([]);
    expect(parseQuestIndexAreas([])).toEqual([]);
    expect(parseQuestIndexAreas({ areas: 'nope' })).toEqual([]);
  });
});

describe('parseQuestAreaQuests', () => {
  it('reads the quest ids and titles of quest/area/717', () => {
    const json = {
      area: { name: 'The Stockade', id: 717 },
      quests: [
        {
          key: key('data/wow/quest/377'),
          name: 'Crime and Punishment',
          id: 377,
        },
        { key: key('data/wow/quest/378'), name: 'The Fury Runs Deep', id: 378 },
        { key: key('data/wow/quest/x'), name: 'bad id', id: 'x' },
      ],
    };
    expect(parseQuestAreaQuests(json)).toEqual([
      { id: 377, name: 'Crime and Punishment' },
      { id: 378, name: 'The Fury Runs Deep' },
    ]);
  });
});

describe('parseBlizzardQuest', () => {
  it('extracts xp, money, reward items and type from quest 1486', () => {
    const parsed = parseBlizzardQuest(QUEST_1486);
    expect(parsed).toMatchObject({
      questId: 1486,
      title: 'Deviate Hides',
      typeId: 81,
      area: { id: 718, name: 'Wailing Caverns' },
      rewardXp: 3100,
      rewardMoneyCopper: 1800,
      rewardItems: [{ id: 918, name: 'Deviate Hide Pack' }],
      reputations: [],
      requirementsRaw: { min_character_level: 13 },
      prerequisiteIds: [],
    });
  });

  it('extracts reputation rewards and prerequisites from quest 378', () => {
    const parsed = parseBlizzardQuest(QUEST_378);
    expect(parsed?.reputations).toEqual([
      { factionId: 47, name: 'Ironforge', value: 150 },
    ]);
    expect(parsed?.rewardMoneyCopper).toBeNull();
    expect(parsed?.rewardItems).toEqual([]);
    expect(parsed?.prerequisiteIds).toEqual([303]);
    expect(parsed?.requirementsRaw).toBe(REQUIREMENTS_378);
  });

  it('keeps the raw response minus _links', () => {
    const parsed = parseBlizzardQuest(QUEST_1486);
    expect(parsed?.raw).not.toHaveProperty('_links');
    expect(Object.keys(parsed?.raw ?? {}).sort()).toEqual([
      'area',
      'description',
      'id',
      'requirements',
      'rewards',
      'title',
      'type',
    ]);
    expect(parsed?.raw.rewards).toBe(QUEST_1486.rewards);
  });

  it('parses a bare quest as nulls and empties', () => {
    expect(parseBlizzardQuest({ id: 5, title: 'Bare' })).toEqual({
      questId: 5,
      title: 'Bare',
      typeId: null,
      area: null,
      rewardXp: null,
      rewardMoneyCopper: null,
      rewardItems: [],
      reputations: [],
      requirementsRaw: null,
      prerequisiteIds: [],
      raw: { id: 5, title: 'Bare' },
    });
  });

  it('returns null without an integer id or a title', () => {
    expect(parseBlizzardQuest({ title: 'No id' })).toBeNull();
    expect(parseBlizzardQuest({ id: 1.5, title: 'Fractional' })).toBeNull();
    expect(parseBlizzardQuest({ id: 1 })).toBeNull();
    expect(parseBlizzardQuest('quest')).toBeNull();
    expect(parseBlizzardQuest(null)).toBeNull();
  });

  it('tolerates alternative shapes: localized title, money units, {value} xp, choice items', () => {
    const parsed = parseBlizzardQuest({
      id: 7,
      title: { en_US: 'Localized' },
      rewards: {
        experience: { value: 450 },
        money: { units: { gold: 1, silver: 2, copper: 3 } },
        items: {
          items: [{ item: { id: 10, name: 'A' } }],
          choice_of: [
            { item: { id: 11, name: 'B' } },
            { item: { id: 10, name: 'A' } },
            { item: null },
          ],
        },
        reputations: [
          { faction: { id: 72, name: 'Stormwind' }, value: 25 },
          { reward: { id: 1 } },
        ],
      },
    });
    expect(parsed?.title).toBe('Localized');
    expect(parsed?.rewardXp).toBe(450);
    expect(parsed?.rewardMoneyCopper).toBe(10203);
    expect(parsed?.rewardItems).toEqual([
      { id: 10, name: 'A' },
      { id: 11, name: 'B' },
    ]);
    expect(parsed?.reputations).toEqual([
      { factionId: 72, name: 'Stormwind', value: 25 },
    ]);
  });
});

describe('extractPrerequisiteIds', () => {
  it('reads ids under any quest-named key and ignores other ids', () => {
    expect(
      extractPrerequisiteIds({
        min_character_level: 20,
        faction: { id: 67, name: 'Horde' },
        previous_quest: { id: 155, name: 'x' },
        prerequisite_quests: [303, 303, 12],
        requires: [{ quest: { key: key('q'), id: 40 } }],
      }),
    ).toEqual([12, 40, 155, 303]);
  });

  it('drops the quest itself and non-positive ids', () => {
    expect(
      extractPrerequisiteIds(
        { quests: [{ id: 378 }, { id: 0 }, { id: 303 }] },
        378,
      ),
    ).toEqual([303]);
  });

  it('reads quests { operator, conditions } with bare { id } conditions (run-2 key path)', () => {
    expect(
      extractPrerequisiteIds({
        quests: {
          operator: { id: 1, type: 'AND' },
          conditions: [{ id: 303 }, { quest: { id: 12 } }],
        },
        faction: { name: 'Alliance', type: 'ALLIANCE' },
        classes: [{ id: 9, name: 'Warlock' }],
      }),
    ).toEqual([12, 303]);
  });

  it('ignores ids under a non-quest conditions key', () => {
    expect(
      extractPrerequisiteIds({ reputation: { conditions: [{ id: 47 }] } }),
    ).toEqual([]);
  });

  it('returns [] for absent or quest-free requirements', () => {
    expect(extractPrerequisiteIds(null)).toEqual([]);
    expect(extractPrerequisiteIds({ min_character_level: 13 })).toEqual([]);
    expect(extractPrerequisiteIds('quest 5')).toEqual([]);
  });
});

describe('collectRequirementKeyPaths', () => {
  it('lists leaf key paths, arrays as [] and without reference hrefs', () => {
    expect(collectRequirementKeyPaths(REQUIREMENTS_378)).toEqual([
      'faction.name',
      'faction.type',
      'min_character_level',
      'quests[].id',
      'quests[].name',
    ]);
  });

  it('records empty arrays and objects as leaves', () => {
    expect(
      collectRequirementKeyPaths({ classes: [], races: {}, level: { min: 1 } }),
    ).toEqual(['classes[]', 'level.min', 'races']);
  });

  it('returns [] for null and primitives', () => {
    expect(collectRequirementKeyPaths(null)).toEqual([]);
    expect(collectRequirementKeyPaths(5)).toEqual([]);
  });
});
