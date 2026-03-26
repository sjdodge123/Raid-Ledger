/**
 * Unit tests for QuestCard keyboard accessibility (ROK-881).
 * Verifies that the quest header div[role="button"] responds to Enter/Space.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QuestCard } from './quest-card';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';

function createQuest(overrides: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId: 100,
        name: 'Test Quest',
        questLevel: 25,
        requiredLevel: 20,
        prevQuestId: null,
        sharable: true,
        rewardGold: null,
        rewardXp: null,
        rewardType: null,
        rewards: [],
        questGiverNpc: null,
        questGiverZone: null,
        prerequisiteChain: null,
        raceRestriction: null,
        classRestriction: null,
        ...overrides,
    } as EnrichedDungeonQuestDto;
}

describe('QuestCardHeader — keyboard handler (ROK-881)', () => {
    it('calls onToggleExpanded on Enter key', () => {
        const onToggle = vi.fn();
        const { container } = render(
            <QuestCard
                quest={createQuest()}
                questCoverage={undefined}
                currentUserId={1}
                eventId={1}
                wowheadVariant="classic"
                isExpanded={false}
                pendingQuestId={null}
                equippedBySlot={new Map()}
                charClass={null}
                characterId={undefined}
                onToggleExpanded={onToggle}
                onTogglePickedUp={vi.fn()}
            />,
        );

        const header = container.querySelector('.quest-card__header')!;
        fireEvent.keyDown(header, { key: 'Enter' });
        expect(onToggle).toHaveBeenCalledWith(100);
    });

    it('calls onToggleExpanded on Space key', () => {
        const onToggle = vi.fn();
        const { container } = render(
            <QuestCard
                quest={createQuest()}
                questCoverage={undefined}
                currentUserId={1}
                eventId={1}
                wowheadVariant="classic"
                isExpanded={false}
                pendingQuestId={null}
                equippedBySlot={new Map()}
                charClass={null}
                characterId={undefined}
                onToggleExpanded={onToggle}
                onTogglePickedUp={vi.fn()}
            />,
        );

        const header = container.querySelector('.quest-card__header')!;
        fireEvent.keyDown(header, { key: ' ' });
        expect(onToggle).toHaveBeenCalledWith(100);
    });
});
