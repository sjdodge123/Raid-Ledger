/** ROK-2216 — a small roster-insights `classes` fixture for the planner's unit tests. */
import type { WowRosterInsightsDto } from '@raid-ledger/contract';

export const UUID_A = '00000000-0000-4000-8000-00000000000a';
export const UUID_B = '00000000-0000-4000-8000-00000000000b';

export const ROSTER: Pick<WowRosterInsightsDto, 'classes'> = {
    classes: [
        { class: 'Warrior', count: 2, members: [
            { name: 'Tanky', characterId: UUID_A, level: 20, memberId: 11 },
            { name: 'Alt', characterId: null, level: 18, memberId: 12 },
        ] },
        { class: 'Mage', count: 2, members: [
            { name: 'Blinky', characterId: UUID_B, level: null },
            { name: 'Ghost', characterId: null, level: 10 },
        ] },
    ],
};
