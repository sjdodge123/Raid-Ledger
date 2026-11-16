/** ROK-2216 — MSW handlers + payloads for the Dungeon planner tab's U6 test. */
import { http, HttpResponse } from 'msw';
import type { DungeonPlanDto, EnrichedDungeonQuestDto, GuildPage, WowInstanceDto } from '@raid-ledger/contract';
import { UUID_A, UUID_B } from './planner-roster.fixtures';

const API = 'http://localhost:3000';

export const PAGE: GuildPage = {
    guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
        memberCount: 5, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

export const INSTANCE: WowInstanceDto = {
    id: 101, name: 'Deadmines', expansion: 'Classic', minimumLevel: 15, maximumLevel: 21, levelSource: 'in_game', wowheadZoneId: null,
};

function quest(questId: number, name: string, over: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId, dungeonInstanceId: INSTANCE.id, name, questLevel: 18, requiredLevel: 14,
        expansion: 'classic', questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null,
        rewardsJson: null, objectives: null, classRestriction: null, raceRestriction: null,
        startsInsideDungeon: false, sharable: true, rewardXp: null, rewardGold: null, rewardType: null,
        rewards: [], prerequisiteChain: null, ...over,
    };
}

/** Two quests the plan lists, one (other-faction) it filtered out. */
export const QUESTS = [quest(501, 'Red Silk Bandanas'), quest(502, 'Oh Brother', { sharable: false }), quest(503, 'Horde Only Quest')];

/** Tanky has both quests; Blinky can't take 502 (absent from perQuest). */
export function makePlan(over: Partial<DungeonPlanDto> = {}): DungeonPlanDto {
    return {
        instance: { id: INSTANCE.id, name: INSTANCE.name, minimumLevel: 15, maximumLevel: 21 },
        side: 'alliance', sideSource: 'guild', hiddenOtherFaction: 1,
        characters: [
            { characterId: UUID_A, name: 'Tanky', class: 'Warrior', level: 20, levelFit: 'in' },
            { characterId: UUID_B, name: 'Blinky', class: 'Mage', level: 12, levelFit: 'below' },
        ],
        droppedCharacterIds: [],
        readiness: {
            quests: [{ questId: 501, title: 'Red Silk Bandanas', instanceId: INSTANCE.id }, { questId: 502, title: 'Oh Brother', instanceId: INSTANCE.id }],
            signups: [
                { userId: 1, characterId: UUID_A, name: 'Tanky', perQuest: [
                    { questId: 501, state: 'have', prereqsMet: true, source: null },
                    { questId: 502, state: 'missing', prereqsMet: false, source: null },
                ] },
                { userId: 2, characterId: UUID_B, name: 'Blinky', perQuest: [{ questId: 501, state: 'missing', prereqsMet: null, source: null }] },
            ],
        },
        ...over,
    };
}

/** Instances list, enriched quests (`questsError` = 500) and the plan read (`onPlan` sees each plan request URL). */
export function plannerHandlers(opts: { instance?: WowInstanceDto; plan?: DungeonPlanDto; onPlan?: (url: URL) => void; questsError?: boolean } = {}): ReturnType<typeof http.get>[] {
    return [
        http.get(`${API}/blizzard/instances`, () => HttpResponse.json({ data: [opts.instance ?? INSTANCE] })),
        http.get(`${API}/plugins/wow-classic/instances/:id/quests/enriched`, () => (
            opts.questsError ? HttpResponse.json({ message: 'boom' }, { status: 500 }) : HttpResponse.json(QUESTS))),
        http.get(`${API}/plugins/wow/guilds/:id/dungeon-plan`, ({ request }) => {
            opts.onPlan?.(new URL(request.url));
            return HttpResponse.json(opts.plan ?? makePlan());
        }),
    ];
}
