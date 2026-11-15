/**
 * ROK-2207 prototype fixtures — illustrative only (quest ids/titles are made
 * up or approximate; the real data comes from `loadEventQuestSet` in the build).
 * Only City of Dalaran and Shadowfang Keep carry quests, so the OQ2 comparison
 * has real numbers and every other dungeon shows the empty state.
 */
import type { EnrichedDungeonQuestDto, EventQuestReadinessDto, QuestReadinessState } from '@raid-ledger/contract';
import type { PlannerCharacter } from './planner-helpers';
import { DALARAN_ID, SFK_ID } from './forever-dungeons.fixtures';

export { DALARAN_ID, SFK_ID } from './forever-dungeons.fixtures';
export const DEMO_HUB_ID = 12;
export const DEMO_GAME_ID = 7;
export const DEMO_GUILD_ID = 3;

function quest(id: number, dungeon: number, name: string, o: Partial<EnrichedDungeonQuestDto>): EnrichedDungeonQuestDto {
    return {
        questId: id, dungeonInstanceId: dungeon, name, questLevel: 30, requiredLevel: 26, expansion: 'classic',
        questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null, rewardsJson: null,
        objectives: null, classRestriction: null, raceRestriction: null, startsInsideDungeon: false, sharable: false,
        rewardXp: null, rewardGold: null, rewardType: null, rewards: null, prerequisiteChain: null, ...o,
    };
}

const D = DALARAN_ID;
const S = SFK_ID;

/** Quests per dungeon id. Dalaran: 2 sharable, 2 chain, 1 solo, 2 inside. SFK: 2 sharable, 2 chain, 1 solo, 1 inside. */
export const QUESTS_BY_DUNGEON: Readonly<Record<number, EnrichedDungeonQuestDto[]>> = {
    [D]: [
        quest(9100001, D, 'The Violet Hold', { sharable: true, questGiverNpc: 'Warden Alturas' }),
        quest(9100002, D, 'Shards of the Kirin Tor', { sharable: true, questGiverNpc: 'Archmage Celindra' }),
        quest(9100003, D, 'Arcane Remnants', { prevQuestId: 9100010, sharable: true }),
        quest(9100004, D, "The Archmage's Errand", { prevQuestId: 9100011 }),
        quest(9100005, D, "Mage-Guard's Badge", { classRestriction: ['Mage'] }),
        quest(9100006, D, 'Whispers Below', { startsInsideDungeon: true, sharable: true }),
        quest(9100007, D, 'The Sunken Archive', { startsInsideDungeon: true }),
    ],
    [S]: [
        quest(1013, S, 'The Book of Ur', { questGiverNpc: 'Keeper Bel\'dugur' }),
        quest(1014, S, 'Arugal Must Die', { sharable: true, questGiverNpc: 'Dalar Dawnweaver' }),
        quest(1098, S, 'Deathstalkers in Shadowfang', { sharable: true, questGiverNpc: 'High Executor Hadrec' }),
        quest(1654, S, 'The Test of Righteousness', { prevQuestId: 1653, classRestriction: ['Paladin'] }),
        quest(1740, S, "The Orb of Soran'ruk", { prevQuestId: 1739, classRestriction: ['Warlock'] }),
        quest(1999, S, 'Sorcerer Ashcrombe', { startsInsideDungeon: true, sharable: true }),
    ],
};

/** Quests for a dungeon; empty when the fixtures carry none (→ empty state). */
export function questsFor(instanceId: number): EnrichedDungeonQuestDto[] {
    return QUESTS_BY_DUNGEON[instanceId] ?? [];
}

const uuid = (n: number): string => `0b6f8c1e-${String(n).padStart(4, '0')}-4a5b-9c11-${String(n).padStart(12, '0')}`;

/** This hub's guild roster (OQ4): 10 claimed characters (anyone's) + 2 unclaimed rows with no quest data. */
export const ROSTER: PlannerCharacter[] = [
    { characterId: uuid(1), name: 'Aelin', className: 'Mage', level: 31 },
    { characterId: uuid(2), name: 'Brann', className: 'Priest', level: 29 },
    { characterId: uuid(3), name: 'Corra', className: 'Rogue', level: 27 },
    { characterId: uuid(4), name: 'Dorn', className: 'Warrior', level: 35 },
    { characterId: null, name: 'Esk', className: 'Hunter', level: 30 },
    { characterId: uuid(6), name: 'Fenna', className: 'Druid', level: 24 },
    { characterId: uuid(7), name: 'Garrick', className: 'Paladin', level: 30 },
    { characterId: uuid(8), name: 'Hesta', className: 'Shaman', level: 23 },
    { characterId: uuid(9), name: 'Ivo', className: 'Warlock', level: 28 },
    { characterId: uuid(10), name: 'Jory', className: 'Hunter', level: 26 },
    { characterId: uuid(11), name: 'Kael', className: 'Warrior', level: 33 },
    { characterId: null, name: 'Lysa', className: 'Priest', level: 25 },
];

type Cell = [QuestReadinessState, boolean | null];
/** Hand-tuned Dalaran states for the five story characters (one per state + an unmet prerequisite). */
const DALARAN_CELLS: Record<string, Cell[]> = {
    Aelin: [['have', true], ['done', true], ['done', true], ['have', true], ['have', true], ['unknown', null], ['missing', true]],
    Brann: [['missing', true], ['have', true], ['missing', false], ['missing', false], ['unknown', null], ['missing', true], ['missing', true]],
    Corra: [['missing', true], ['missing', true], ['unknown', null], ['missing', true], ['unknown', null], ['missing', true], ['unknown', null]],
    Dorn: [['done', true], ['done', true], ['done', true], ['done', true], ['unknown', null], ['done', true], ['done', true]],
};

const CYCLE: QuestReadinessState[] = ['have', 'missing', 'done', 'missing', 'have'];

/** A deterministic cell for everyone/everything the hand table does not cover. */
function cellFor(c: PlannerCharacter, ci: number, q: EnrichedDungeonQuestDto, qi: number): Cell {
    if (!c.characterId) return ['unknown', null];
    const hand = q.dungeonInstanceId === DALARAN_ID ? DALARAN_CELLS[c.name]?.[qi] : undefined;
    if (hand) return hand;
    const state = CYCLE[(ci * 3 + qi) % CYCLE.length] ?? 'unknown';
    return [state, q.prevQuestId ? (ci + qi) % 3 !== 0 : true];
}

/** Readiness rows in the event endpoint's shape for one dungeon's quests. */
export function readinessFor(chars: PlannerCharacter[], instanceId: number): EventQuestReadinessDto['signups'] {
    const quests = questsFor(instanceId);
    return chars.map((c, i) => ({
        userId: i + 1, characterId: c.characterId, name: c.name,
        perQuest: quests.map((q, qi) => {
            const [state, prereqsMet] = cellFor(c, ROSTER.findIndex((r) => r.name === c.name), q, qi);
            return { questId: q.questId, state, prereqsMet, source: c.characterId ? 'blizzard' as const : null };
        }),
    }));
}
