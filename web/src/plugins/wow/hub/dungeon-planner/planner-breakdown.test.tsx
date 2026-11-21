/** ROK-2276 — the hub Dungeon planner shows the same three location groups as Quest Prep. */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { QuestBreakdown } from './planner-breakdown';

function createQuest(overrides: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId: 100, dungeonInstanceId: 1, name: 'Test Quest', questLevel: 25, requiredLevel: 20,
        expansion: 'classic', questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null,
        rewardsJson: null, objectives: null, classRestriction: null, raceRestriction: null,
        startsInsideDungeon: false, sharable: true, rewardXp: null, rewardGold: null, rewardType: null,
        rewards: [], prerequisiteChain: null, ...overrides,
    };
}

const BEFORE = createQuest({ questId: 1, name: 'Outside Quest' });
const INSIDE = createQuest({ questId: 2, name: 'Inside Quest', startsInsideDungeon: true });
const UNCONFIRMED = createQuest({ questId: 3, name: 'Blizzard Only', startLocationUnconfirmed: true });

/** The location-group headings in document order. */
function groupHeadings(): string[] {
    return screen.getAllByText(/\(\d+\)$/, { selector: 'p.text-sm' }).map((el) => el.textContent ?? '');
}

describe('QuestBreakdown location groups (ROK-2276)', () => {
    it('renders before → inside → "Location not confirmed", with its hint', () => {
        renderWithProviders(<QuestBreakdown quests={[UNCONFIRMED, INSIDE, BEFORE]} signups={[]} note={null} />);
        expect(groupHeadings()).toEqual([
            '\u{1F5FA}\u{FE0F} Get before you go in (1)', '\u{1F3F0} Picked up inside (1)', '❔ Location not confirmed (1)',
        ]);
        expect(screen.getByText("We don't know yet if these start outside or inside")).toBeInTheDocument();
    });

    it('hides "Location not confirmed" when every quest has start evidence', () => {
        renderWithProviders(<QuestBreakdown quests={[BEFORE, INSIDE]} signups={[]} note={null} />);
        expect(screen.queryByText(/Location not confirmed/)).not.toBeInTheDocument();
    });
});
