/** ROK-2224 — the planner's quest row flags escort quests with an "Escort" chip. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import { QuestRow } from './planner-quest-row';
import { INSTANCE } from './dungeon-planner-tab.fixtures';

function quest(over: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId: 601, dungeonInstanceId: INSTANCE.id, name: 'Escort Me', questLevel: 18, requiredLevel: 14,
        expansion: 'classic', questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null,
        rewardsJson: null, objectives: null, classRestriction: null, raceRestriction: null,
        startsInsideDungeon: false, sharable: false, rewardXp: null, rewardGold: null, rewardType: null,
        rewards: [], prerequisiteChain: null, ...over,
    };
}

function renderRow(over: Partial<EnrichedDungeonQuestDto>): void {
    render(<ul><QuestRow quest={quest(over)} signups={[]} /></ul>);
}

describe('planner QuestRow — escort marker (ROK-2224)', () => {
    it('shows an "Escort" chip with its explanation for an escort quest', () => {
        renderRow({ isEscort: true });
        const row = screen.getByTestId('planner-quest-601');
        expect(row).toHaveTextContent('Escort Me');
        expect(screen.getByText('Escort')).toHaveAttribute('title', expect.stringContaining('NPC must survive'));
    });

    it('shows no "Escort" chip when isEscort is false', () => {
        renderRow({ isEscort: false });
        expect(screen.queryByText('Escort'), 'isEscort: false').toBeNull();
    });

    it('shows no "Escort" chip when the flag is absent', () => {
        renderRow({});
        expect(screen.queryByText('Escort')).toBeNull();
    });
});
