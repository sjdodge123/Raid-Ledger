/** ROK-2224 — the hub Dungeon quests views flag escort quests with an "Escort" chip. */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { EventQuestReadinessDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { QuestCompactList, QuestMatrix } from './dungeon-quests-matrix';

type Quest = EventQuestReadinessDto['quests'][number];
type Signup = EventQuestReadinessDto['signups'][number];

const QUESTS: Quest[] = [
    { questId: 701, title: 'Guard the Caravan', instanceId: 1, isEscort: true },
    { questId: 702, title: 'Fetch the Ore', instanceId: 1 },
];
const SIGNUPS: Signup[] = [
    { userId: 1, characterId: null, name: 'Aelin', perQuest: [{ questId: 701, state: 'have', prereqsMet: true, source: null }] },
];

describe('Dungeon quests views — escort marker (ROK-2224)', () => {
    it('the matrix flags only the escort quest\'s column header', () => {
        renderWithProviders(<QuestMatrix quests={QUESTS} signups={SIGNUPS} label="Readiness" />);
        const headers = screen.getAllByRole('columnheader');
        const escortHeader = headers.find((h) => h.textContent?.includes('Guard the Caravan'));
        const plainHeader = headers.find((h) => h.textContent?.includes('Fetch the Ore'));
        expect(escortHeader && within(escortHeader).getByText('Escort')).toHaveAttribute('title', expect.stringContaining('Escort quest'));
        expect(plainHeader && within(plainHeader).queryByText('Escort'), 'no chip on a non-escort quest').toBeNull();
    });

    it('the phone list flags the escort quest and nothing else', () => {
        renderWithProviders(<QuestCompactList quests={QUESTS} signups={SIGNUPS} label="Readiness" />);
        expect(screen.getAllByText('Escort')).toHaveLength(1);
        const item = screen.getByText('Guard the Caravan').closest('li');
        expect(item && within(item).getByText('Escort')).toBeInTheDocument();
    });
});
