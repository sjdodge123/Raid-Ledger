/**
 * ROK-1748 — coverage source label: addon-derived coverage shows the shared
 * "via addon · <date>" line; manual/Classic coverage keeps the existing markup.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestCard } from './quest-card';
import { formatAddonSourceLine } from '../lib/addon-source-line';
import type { EnrichedDungeonQuestDto, QuestCoverageEntry } from '@raid-ledger/contract';

const AS_OF = '2026-10-01T12:00:00.000Z';

const quest = {
    questId: 100, name: 'Test Quest', questLevel: 25, requiredLevel: 20, prevQuestId: null,
    sharable: true, rewardGold: null, rewardXp: null, rewardType: null, rewards: [],
    questGiverNpc: null, questGiverZone: null, prerequisiteChain: null,
    raceRestriction: null, classRestriction: null,
} as unknown as EnrichedDungeonQuestDto;

function renderCard(coveredBy: QuestCoverageEntry['coveredBy'], currentUserId = 1) {
    return render(
        <QuestCard quest={quest} questCoverage={{ questId: 100, coveredBy }} currentUserId={currentUserId}
            eventId={1} wowheadVariant="classic" isExpanded pendingQuestId={null}
            equippedBySlot={new Map()} charClass={null} characterId={undefined}
            onToggleExpanded={vi.fn()} onTogglePickedUp={vi.fn()} />,
    );
}

describe('QuestCard coverage source label (ROK-1748)', () => {
    it('addon coverage (covered by others) renders the shared source line with the date', () => {
        renderCard([{ userId: 2, username: 'Mateprereq', source: 'addon', asOf: AS_OF }]);
        const label = screen.getByTestId('quest-coverage-source');
        expect(label).toHaveTextContent(formatAddonSourceLine(AS_OF));
        expect(label.textContent).toMatch(/^via addon · \d/);
        expect(label).toHaveClass('text-xs', 'text-muted');
    });

    it('addon coverage on the "You have this quest" path also renders the label', () => {
        renderCard([
            { userId: 1, username: 'Me', source: 'addon', asOf: AS_OF },
            { userId: 2, username: 'Mateprereq', source: 'addon', asOf: AS_OF },
        ]);
        expect(screen.getByText(/also: Mateprereq/)).toBeInTheDocument();
        expect(screen.getByTestId('quest-coverage-source')).toHaveTextContent(formatAddonSourceLine(AS_OF));
    });

    it('manual/Classic coverage renders no label and the existing markup', () => {
        const { container } = renderCard([{ userId: 2, username: 'Mate' }]);
        expect(screen.queryByTestId('quest-coverage-source')).toBeNull();
        expect(screen.queryByText(/via addon/)).toBeNull();
        expect(container.querySelector('.quest-card__details-right')!.innerHTML)
            .toBe('<span class="quest-coverage__status">✓ Covered by Mate</span>');
    });

    it('mixed manual + addon coverage renders the label exactly once', () => {
        renderCard([
            { userId: 2, username: 'Mate', source: 'manual' },
            { userId: 3, username: 'Mateprereq', source: 'addon', asOf: AS_OF },
            { userId: 4, username: 'Other', source: 'addon', asOf: AS_OF },
        ]);
        expect(screen.getAllByTestId('quest-coverage-source')).toHaveLength(1);
        expect(screen.getAllByText(/via addon/)).toHaveLength(1);
    });
});
