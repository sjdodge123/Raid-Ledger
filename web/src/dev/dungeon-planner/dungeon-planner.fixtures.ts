/**
 * ROK-2207 prototype fixtures — illustrative only (quest ids/titles for City of
 * Dalaran are made up; the real data comes from `loadEventQuestSet` in the build).
 */
import type {
    EnrichedDungeonQuestDto, EventQuestReadinessDto, QuestReadinessState, WowInstanceDto,
} from '@raid-ledger/contract';
import type { PlannerCharacter } from './planner-helpers';

export const DEMO_HUB_ID = 12;
export const DEMO_GAME_ID = 7;
export const DEMO_GUILD_ID = 3;
export const DALARAN_ID = 90000004;

/** Same rows the event dungeon picker lists (`useWowInstances('wow_forever','dungeon')`). */
export const INSTANCES: WowInstanceDto[] = [
    { id: 389, name: 'Ragefire Chasm', shortName: 'RFC', expansion: 'Classic', minimumLevel: 13, maximumLevel: 18 },
    { id: 63, name: 'The Deadmines', shortName: 'VC', expansion: 'Classic', minimumLevel: 17, maximumLevel: 26 },
    { id: 43, name: 'Wailing Caverns', shortName: 'WC', expansion: 'Classic', minimumLevel: 17, maximumLevel: 24 },
    { id: 33, name: 'Shadowfang Keep', shortName: 'SFK', expansion: 'Classic', minimumLevel: 22, maximumLevel: 30 },
    { id: 31601, name: 'Scarlet Monastery: Graveyard', shortName: 'SM GY', expansion: 'Classic', minimumLevel: 26, maximumLevel: 36 },
    { id: DALARAN_ID, name: 'City of Dalaran', expansion: 'Forever', minimumLevel: 28, maximumLevel: 33 },
];

/** Hand-kept instanceId → Wowhead zone id (spec D7). Dalaran has none yet → no link. */
export const WOWHEAD_ZONE_IDS: Readonly<Record<number, number>> = { 389: 2437, 63: 1581, 43: 718, 33: 209, 31601: 796 };

function quest(id: number, name: string, o: Partial<EnrichedDungeonQuestDto>): EnrichedDungeonQuestDto {
    return {
        questId: id, dungeonInstanceId: DALARAN_ID, name, questLevel: 30, requiredLevel: 26, expansion: 'classic',
        questGiverNpc: null, questGiverZone: 'Dalaran', prevQuestId: null, nextQuestId: null, rewardsJson: null,
        objectives: null, classRestriction: null, raceRestriction: null, startsInsideDungeon: false, sharable: false,
        rewardXp: null, rewardGold: null, rewardType: null, rewards: null, prerequisiteChain: null, ...o,
    };
}

/** 2 sharable, 2 chain (with a prerequisite), 1 solo, 2 that start inside the dungeon. */
export const DALARAN_QUESTS: EnrichedDungeonQuestDto[] = [
    quest(9100001, 'The Violet Hold', { sharable: true, questGiverNpc: 'Warden Alturas' }),
    quest(9100002, 'Shards of the Kirin Tor', { sharable: true, questGiverNpc: 'Archmage Celindra' }),
    quest(9100003, 'Arcane Remnants', { prevQuestId: 9100010, sharable: true }),
    quest(9100004, "The Archmage's Errand", { prevQuestId: 9100011 }),
    quest(9100005, "Mage-Guard's Badge", { classRestriction: ['Mage'] }),
    quest(9100006, 'Whispers Below', { startsInsideDungeon: true, sharable: true }),
    quest(9100007, 'The Sunken Archive', { startsInsideDungeon: true }),
];

/** Every state + one unmet prerequisite, one below range, one above, one with no linked character. */
export const CHARACTERS: PlannerCharacter[] = [
    { characterId: '0b6f8c1e-1111-4a5b-9c11-000000000001', name: 'Aelin', className: 'Mage', level: 31 },
    { characterId: '0b6f8c1e-2222-4a5b-9c11-000000000002', name: 'Brann', className: 'Priest', level: 29 },
    { characterId: '0b6f8c1e-3333-4a5b-9c11-000000000003', name: 'Corra', className: 'Rogue', level: 27 },
    { characterId: '0b6f8c1e-4444-4a5b-9c11-000000000004', name: 'Dorn', className: 'Warrior', level: 35 },
    { characterId: null, name: 'Esk', className: 'Hunter', level: 30 },
];

type Cell = [QuestReadinessState, boolean | null];
const S: Record<string, Cell[]> = {
    Aelin: [['have', true], ['done', true], ['done', true], ['have', true], ['have', true], ['unknown', null], ['missing', true]],
    Brann: [['missing', true], ['have', true], ['missing', false], ['missing', false], ['unknown', null], ['missing', true], ['missing', true]],
    Corra: [['missing', true], ['missing', true], ['unknown', null], ['missing', true], ['unknown', null], ['missing', true], ['unknown', null]],
    Dorn: [['done', true], ['done', true], ['done', true], ['done', true], ['unknown', null], ['done', true], ['done', true]],
    Esk: [['unknown', null], ['unknown', null], ['unknown', null], ['unknown', null], ['unknown', null], ['unknown', null], ['unknown', null]],
};

/** Readiness rows in the event endpoint's shape, so `QuestMatrix` renders them unchanged. */
export function readinessFor(chars: PlannerCharacter[]): EventQuestReadinessDto['signups'] {
    return chars.map((c, i) => ({
        userId: i + 1, characterId: c.characterId, name: c.name,
        perQuest: DALARAN_QUESTS.map((q, qi) => {
            const [state, prereqsMet] = S[c.name]?.[qi] ?? ['unknown', null];
            return { questId: q.questId, state, prereqsMet, source: c.characterId ? 'blizzard' as const : null };
        }),
    }));
}

/** The matrix's quest columns. */
export const MATRIX_QUESTS: EventQuestReadinessDto['quests'] = DALARAN_QUESTS.map((q) => ({
    questId: q.questId, title: q.name, instanceId: DALARAN_ID,
}));
