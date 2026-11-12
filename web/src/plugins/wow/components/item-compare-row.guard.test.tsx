/**
 * ROK-2186 guard: quest rewards and boss loot render ONE row component
 * (`ItemCompareRow`) so their stat deltas + compare popup cannot fork again.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BossLootBody } from '../slots/boss-loot-body';
import { QuestCard } from '../slots/quest-card';
import { EQUIPPED_LEGS, LOOT_LEGS, REWARD_LEGS, questWith } from './item-compare-row.fixtures';

vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => false }));

const EQUIP = new Map([['LEGS', EQUIPPED_LEGS]]);
const SHARED_IMPORT = /from '\.\.\/components\/item-compare-row'/;
/** Row pieces only the shared row may compose. */
const ROW_PIECES = [/from '\.\.\/components\/item-comparison'/, /from '\.\.\/components\/item-compare-dialog'/, /from '\.\.\/components\/wow-item-card'/];

function source(file: string): string {
    const raw = readFileSync(resolve(__dirname, '../slots', file), 'utf-8');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function rowOf(container: HTMLElement): HTMLElement {
    const rows = within(container).getAllByTestId('item-compare-row');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error('no item-compare-row');
    return row;
}

describe('ItemCompareRow guard (ROK-2186)', () => {
    it.each(['boss-loot-body.tsx', 'quest-card.tsx'])('%s imports the shared row and none of its pieces', (file) => {
        const src = source(file);
        expect(src).toMatch(SHARED_IMPORT);
        for (const piece of ROW_PIECES) expect(src).not.toMatch(piece);
    });

    it('boss loot and a quest reward render the same row with the same stat chips', () => {
        const loot = render(<BossLootBody loot={[LOOT_LEGS]} isLoading={false} wowheadVariant="classic_era"
            equippedBySlot={EQUIP} characterClass="Mage" hasCharacter />);
        const lootRow = rowOf(loot.container);
        const quest = render(<QuestCard quest={questWith([REWARD_LEGS])} questCoverage={undefined} currentUserId={1}
            eventId={1} wowheadVariant="classic_era" isExpanded pendingQuestId={null} equippedBySlot={EQUIP}
            charClass="Mage" characterId="c1" onToggleExpanded={vi.fn()} onTogglePickedUp={vi.fn()} />);
        const questRow = rowOf(quest.container);
        for (const row of [lootRow, questRow]) {
            expect(within(row).getByTestId('stat-delta-chips')).toBeInTheDocument();
            expect(within(row).getByText('Old Leggings')).toBeInTheDocument();
        }
        expect(screen.queryByText(/undefined/)).toBeNull();
    });
});
