/**
 * Unit tests for QuestCard keyboard accessibility (ROK-881).
 * Verifies that the quest header div[role="button"] responds to Enter/Space.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { QuestCard } from './quest-card';
import type { EnrichedDungeonQuestDto, QuestPrereqState } from '@raid-ledger/contract';

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

describe('QuestCardHeader — Done pill (ROK-1748)', () => {
    function renderCard(prereqs?: { state: QuestPrereqState }) {
        return render(
            <QuestCard quest={createQuest()} questCoverage={undefined} currentUserId={1} eventId={1}
                wowheadVariant="classic" isExpanded={false} pendingQuestId={null}
                equippedBySlot={new Map()} charClass={null} characterId={undefined}
                onToggleExpanded={vi.fn()} onTogglePickedUp={vi.fn()} prereqs={prereqs} />,
        );
    }
    const base: QuestPrereqState = { questId: 100, steps: [], neededCount: 0, completed: true, completedSource: 'addon' };

    it('shows a text-success "Done" pill when the viewer completed the quest', () => {
        renderCard({ state: base });
        expect(screen.getByText('Done')).toHaveClass('text-success');
    });

    it('shows no pill when the quest is not completed', () => {
        renderCard({ state: { ...base, completed: false } });
        expect(screen.queryByText('Done')).toBeNull();
    });

    it('shows no pill without a state (Classic)', () => {
        renderCard();
        expect(screen.queryByText('Done')).toBeNull();
    });

    it('names the "↗" Wowhead link "View on Wowhead" for screen readers (ROK-1758)', () => {
        renderCard();
        expect(screen.getByRole('link', { name: 'View on Wowhead' })).toHaveAttribute('href', expect.stringContaining('quest=100'));
    });
});


describe('QuestCard — prerequisite not in our data (ROK-2143)', () => {
    function renderExpanded(overrides: Partial<EnrichedDungeonQuestDto>) {
        return render(
            <QuestCard quest={createQuest(overrides)} questCoverage={undefined} currentUserId={1} eventId={1}
                wowheadVariant="classic" isExpanded pendingQuestId={null} equippedBySlot={new Map()}
                charClass={null} characterId={undefined} onToggleExpanded={vi.fn()} onTogglePickedUp={vi.fn()} />,
        );
    }

    it('a dangling prevQuestId shows no Chain badge, no self "Requires" and a muted not-in-data line', () => {
        const { container } = renderExpanded({ prevQuestId: 99, prerequisiteChain: null });
        expect(screen.queryByText('Chain'), 'no Chain badge without a resolved prerequisite').toBeNull();
        expect(screen.queryByText('Requires:'), 'the quest must not be listed as its own prerequisite').toBeNull();
        const line = screen.getByTestId('quest-prereq-missing');
        expect(line).toHaveTextContent('Prerequisite not in data');
        expect(line).toHaveClass('text-muted');
        expect(container.querySelector('.quest-coverage__btn'), 'a quest with a prerequisite stays non-shareable').toBeNull();
    });

    it('a chain holding only the quest itself (old api shape) renders no badge and no self "Requires"', () => {
        renderExpanded({ prevQuestId: 99, prerequisiteChain: [createQuest()] });
        expect(screen.queryByText('Chain')).toBeNull();
        expect(screen.queryByText('Requires:')).toBeNull();
        expect(screen.getByTestId('quest-prereq-missing')).toBeInTheDocument();
    });

    it('a resolved chain keeps the badge with the count of quests before this one', () => {
        renderExpanded({
            prevQuestId: 50,
            prerequisiteChain: [createQuest({ questId: 50, name: 'Step One' }), createQuest(), createQuest({ questId: 150, name: 'Next' })],
        });
        expect(screen.getByText('Chain')).toHaveAttribute('title', 'Requires 1 prerequisite quest(s)');
        expect(screen.getByText('Requires:')).toBeInTheDocument();
        expect(screen.queryByTestId('quest-prereq-missing')).toBeNull();
    });
});

describe('QuestCard — reputation rewards (ROK-2161)', () => {
    function renderExpanded(overrides: Partial<EnrichedDungeonQuestDto>) {
        return render(
            <QuestCard quest={createQuest(overrides)} questCoverage={undefined} currentUserId={1} eventId={1}
                wowheadVariant="classic" isExpanded pendingQuestId={null} equippedBySlot={new Map()}
                charClass={null} characterId={undefined} onToggleExpanded={vi.fn()} onTogglePickedUp={vi.fn()} />,
        );
    }

    it('shows the reputation line next to the XP reward', () => {
        renderExpanded({
            rewardXp: 1150,
            reputationRewards: [{ factionName: 'Ironforge', amount: 150 }, { factionName: 'Gnomeregan', amount: -25 }],
        });
        const line = screen.getByTestId('quest-reward-reputation');
        expect(line).toHaveTextContent('+150 Ironforge, -25 Gnomeregan');
        expect(line).toHaveClass('text-success');
        expect(line.closest('.quest-reward-meta'), 'sits in the XP / money reward row').not.toBeNull();
    });

    it('renders a reputation-only quest reward row', () => {
        renderExpanded({ reputationRewards: [{ factionName: 'Ironforge', amount: 150 }] });
        expect(screen.getByTestId('quest-reward-reputation')).toHaveTextContent('+150 Ironforge');
    });

    it('renders no reputation line when the field is absent or empty', () => {
        const { unmount } = renderExpanded({ rewardXp: 1150 });
        expect(screen.queryByTestId('quest-reward-reputation')).toBeNull();
        unmount();
        renderExpanded({ rewardXp: 1150, reputationRewards: [] });
        expect(screen.queryByTestId('quest-reward-reputation')).toBeNull();
    });
});
