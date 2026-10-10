import {
  ADDON_QUESTS_COMPLETED_MAX,
  type AddonCharExport,
  type AddonQuests,
  type AddonTalentNode,
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

/** `count` completed ids (the level-8 probe saw 40) + 3 quests in the log. */
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

export function buildQuests(count = 40): AddonQuests {
  const completed = Array.from({ length: count }, (_, i) => 456 + i * 7);
  return { completed, inProgress: structuredClone(IN_PROGRESS) };
}

function foreverWho(gender: 'male' | 'female') {
  return buildWho({ class: 'WARRIOR', race: 'NightElf', gender, level: 8 });
}

/**
 * Enchanted + socketed links (link fields 1 and 2-5) so the fixtures pin
 * the snapshot-2 `enchantId` / `gemIds` parse; ids are game data.
 */
export const FOREVER_ENCHANTED_LINK =
  '|cff0070dd|Hitem:6120:1900:2000::::::8:0:0:0:1:7890|h[Recruit Shirt]|h|r';
export const FOREVER_SOCKETED_LINK =
  '|cff1eff00|Hitem:2105:0:3000:3001:::::8|h[Thug Shirt]|h|r';

function foreverGear(): AddonCharExport['data']['gear'] {
  return [
    { slot: 5, link: FOREVER_ENCHANTED_LINK, ilvl: 5 },
    { slot: 4, link: FOREVER_SOCKETED_LINK, ilvl: 4 },
    { slot: 1, itemId: 16921, ilvl: 76 },
  ];
}

function foreverChar(
  gender: 'male' | 'female',
  data: Partial<AddonCharExport['data']>,
): AddonCharExport {
  const base = buildCharPayload({ who: foreverWho(gender) });
  return { ...base, data: { ...base.data, gear: foreverGear(), ...data } };
}

/** Named + positioned talent nodes, `gender: male`, no quests. */
export function buildForeverTalentsPayload(): AddonCharExport {
  return foreverChar('male', {
    talents: { configId: 7, nodes: buildForeverTalentNodes() },
  });
}

/**
 * `data.quests` present with `completed` at `ADDON_QUESTS_COMPLETED_MAX`
 * (proves > 2000 is accepted, Lead ruling 1), `gender: female`.
 */
export function buildForeverQuestsPayload(
  completed = ADDON_QUESTS_COMPLETED_MAX,
): AddonCharExport {
  return foreverChar('female', { quests: buildQuests(completed) });
}

/**
 * `data.quests` as the addon sends it after cutting `completed` at the cap:
 * a small id list + `completedTruncated: true` (ROK-1742 additive flag).
 */
export function buildForeverQuestsTruncatedPayload(): AddonCharExport {
  const quests = { ...buildQuests(3), completedTruncated: true };
  return foreverChar('female', { quests });
}
