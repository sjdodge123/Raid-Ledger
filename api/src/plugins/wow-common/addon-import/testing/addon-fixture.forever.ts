import type {
  AddonCharExport,
  AddonQuests,
  AddonTalentNode,
} from '@raid-ledger/contract';
import { buildCharPayload, buildWho } from './addon-fixture.builder';

/**
 * ROK-1742 fixture data for the additive Forever `char` fields. Synthetic
 * (CONTRACT.md §8) but beta-shaped: a level-8 Night Elf Warrior with real
 * game-data ids (node/entry/spell/quest ids are game data, not personal
 * data). Node 105926 → "Improved Intercept" and posX 6820 / posY 4530 come
 * from the addon's S3 probe; every other row/col/pos value is synthetic but
 * consistent with the 12-column × 7-tier rule in CONTRACT.md §3.
 */
const FOREVER_TALENT_NODES: readonly AddonTalentNode[] = [
  {
    nodeId: 105901,
    rank: 3,
    entryId: 130631,
    spellId: 12295,
    name: 'Tactical Mastery',
    maxRanks: 5,
    tree: 0,
    row: 0,
    col: 1,
    posX: 1980,
    posY: 2130,
  },
  {
    nodeId: 105926,
    rank: 0,
    entryId: 130656,
    spellId: 20504,
    name: 'Improved Intercept',
    maxRanks: 2,
    tree: 1,
    row: 3,
    col: 2,
    posX: 6820,
    posY: 4530,
  },
  {
    nodeId: 105940,
    rank: 2,
    entryId: 130670,
    spellId: 12320,
    name: 'Cruelty',
    maxRanks: 5,
    tree: 1,
    row: 0,
    col: 2,
    posX: 6820,
    posY: 2130,
  },
  {
    nodeId: 105961,
    rank: 1,
    entryId: 130691,
    spellId: 12298,
    name: 'Shield Specialization',
    maxRanks: 5,
    tree: 2,
    row: 0,
    col: 1,
    posX: 8920,
    posY: 2130,
  },
];

export function buildForeverTalentNodes(): AddonTalentNode[] {
  return FOREVER_TALENT_NODES.map((n) => ({ ...n }));
}

/** 40 completed ids (the level-8 probe saw 40) + 3 quests in the log. */
const IN_PROGRESS: AddonQuests['inProgress'] = [
  {
    questId: 2459,
    title: 'Ferocitas the Dream Eater',
    objectives: [
      {
        text: 'Ferocitas the Dream Eater slain: 0/1',
        done: false,
        have: 0,
        need: 1,
      },
      { text: 'Gnarlpine Mystic slain: 7/7', done: true, have: 7, need: 7 },
    ],
  },
  {
    questId: 488,
    title: "Zenn's Bidding",
    objectives: [
      { text: 'Nightsaber Fang: 2/3', done: false, have: 2, need: 3 },
      { text: 'Strigid Owl Feather: 3/3', done: true, have: 3, need: 3 },
      { text: 'Webwood Spider Silk: 1/3', done: false, have: 1, need: 3 },
    ],
  },
  { questId: 6344, title: 'Nessa Shadowsong' },
];

export function buildQuests(): AddonQuests {
  const completed = Array.from({ length: 40 }, (_, i) => 456 + i * 7);
  return { completed, inProgress: structuredClone(IN_PROGRESS) };
}

function foreverWho(gender: 'male' | 'female') {
  return buildWho({ class: 'WARRIOR', race: 'NightElf', gender, level: 8 });
}

/** Named + positioned talent nodes, `gender: male`, no quests. */
export function buildForeverTalentsPayload(): AddonCharExport {
  const base = buildCharPayload({ who: foreverWho('male') });
  return {
    ...base,
    data: {
      ...base.data,
      talents: { configId: 7, nodes: buildForeverTalentNodes() },
    },
  };
}

/** `data.quests` present, `gender: female`. */
export function buildForeverQuestsPayload(): AddonCharExport {
  const base = buildCharPayload({ who: foreverWho('female') });
  return { ...base, data: { ...base.data, quests: buildQuests() } };
}
