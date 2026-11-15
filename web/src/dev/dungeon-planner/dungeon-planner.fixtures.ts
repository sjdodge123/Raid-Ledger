/**
 * ROK-2207 prototype fixtures — illustrative only (quest ids/titles are made
 * up or approximate; the real data comes from `loadEventQuestSet` in the build).
 * Only City of Dalaran and Shadowfang Keep carry quests; every other dungeon
 * shows the empty state. The demo guild is Alliance (a guild is one faction);
 * Dalaran carries a same-name Alliance/Horde pair plus a Horde-only quest so
 * the faction filter visibly hides something.
 */
import type { EnrichedDungeonQuestDto, EventQuestReadinessDto, QuestReadinessState } from '@raid-ledger/contract';
import type { PlannerCharacter } from './planner-helpers';
import type { GuildFaction, PlannerQuest, QuestFaction } from './planner-faction';
import { DALARAN_ID, SFK_ID } from './forever-dungeons.fixtures';

export { DALARAN_ID, SFK_ID } from './forever-dungeons.fixtures';
export const DEMO_HUB_ID = 12;
export const DEMO_GAME_ID = 7;
export const DEMO_GUILD_ID = 3;
/** The demo guild's single faction (ruling ~19:05Z: no guild has both). */
export const DEMO_GUILD_FACTION: GuildFaction = 'alliance';

function quest(
    id: number, dungeon: number, name: string, o: Partial<EnrichedDungeonQuestDto>, faction: QuestFaction = 'neutral',
): PlannerQuest {
    return {
        questId: id, dungeonInstanceId: dungeon, name, questLevel: 30, requiredLevel: 26, expansion: 'classic',
        questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null, rewardsJson: null,
        objectives: null, classRestriction: null, raceRestriction: null, startsInsideDungeon: false, sharable: false,
        rewardXp: null, rewardGold: null, rewardType: null, rewards: null, prerequisiteChain: null, ...o, faction,
    };
}

const D = DALARAN_ID;
const S = SFK_ID;

/**
 * Quests per dungeon id, every one tagged alliance / horde / neutral. Dalaran (Alliance view): 2 sharable,
 * 2 chain, 2 solo, 2 inside; hidden: the Horde "The Archmage's Errand" and "Sunreaver Orders".
 * New rows are appended so the hand-tuned readiness cells below keep their indices.
 */
export const QUESTS_BY_DUNGEON: Readonly<Record<number, PlannerQuest[]>> = {
    [D]: [
        quest(9100001, D, 'The Violet Hold', { sharable: true, questGiverNpc: 'Warden Alturas' }),
        quest(9100002, D, 'Shards of the Kirin Tor', { sharable: true, questGiverNpc: 'Archmage Celindra' }),
        quest(9100003, D, 'Arcane Remnants', { prevQuestId: 9100010, sharable: true }),
        quest(9100004, D, "The Archmage's Errand", { prevQuestId: 9100011 }, 'alliance'),
        quest(9100005, D, "Mage-Guard's Badge", { classRestriction: ['Mage'] }),
        quest(9100006, D, 'Whispers Below', { startsInsideDungeon: true, sharable: true }),
        quest(9100007, D, 'The Sunken Archive', { startsInsideDungeon: true }),
        quest(9100104, D, "The Archmage's Errand", { prevQuestId: 9100111 }, 'horde'),
        quest(9100108, D, 'Sunreaver Orders', { questGiverNpc: 'Magister Hathorel' }, 'horde'),
        quest(9100109, D, 'Silver Covenant Dispatch', { questGiverNpc: 'Vereesa Windrunner' }, 'alliance'),
    ],
    [S]: [
        quest(1013, S, 'The Book of Ur', { questGiverNpc: 'Keeper Bel\'dugur' }, 'horde'),
        quest(1014, S, 'Arugal Must Die', { sharable: true, questGiverNpc: 'Dalar Dawnweaver' }, 'horde'),
        quest(1098, S, 'Deathstalkers in Shadowfang', { sharable: true, questGiverNpc: 'High Executor Hadrec' }, 'horde'),
        quest(1654, S, 'The Test of Righteousness', { prevQuestId: 1653, classRestriction: ['Paladin'] }, 'alliance'),
        quest(1740, S, "The Orb of Soran'ruk", { prevQuestId: 1739, classRestriction: ['Warlock'] }),
        quest(1999, S, 'Sorcerer Ashcrombe', { startsInsideDungeon: true, sharable: true }),
    ],
};

/** Quests for a dungeon; empty when the fixtures carry none (→ empty state). */
export function questsFor(instanceId: number): PlannerQuest[] {
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
