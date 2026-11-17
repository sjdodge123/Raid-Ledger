/**
 * ROK-2212 verify FAIL (2026-11-17) — layout contracts jsdom can only check by
 * class: (A) every member row shows its role VISIBLY at every breakpoint — never
 * `sr-only lg:not-sr-only`, which index.css's unlayered `.sr-only` beats; (B) in
 * the narrow widget card an unclaimed member's name never shrinks to 0px — the
 * name + "Unclaimed" chip wrap inside a `min-w-0` cell and the level stays put;
 * (C) the planner section lays the five members out as a 5-column grid ≥1024px.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { buttonClass } from '../../../../components/ui/button-classes';
import { renderWithProviders } from '../../../../test/render-helpers';
import { PAGE } from '../dungeon-planner/dungeon-planner-tab.fixtures';
import { SuggestedGroupCard, type SuggestedGroupCardProps } from './suggested-group-card';
import { group } from './suggested-groups.fixtures';

function renderCard(layout?: SuggestedGroupCardProps['layout']): HTMLElement {
    renderWithProviders(<SuggestedGroupCard group={group(101, 'Shadowfang Keep')} page={PAGE} canAct layout={layout} />);
    return screen.getByTestId('suggested-group-card');
}

function classesOf(el: Element): string[] {
    return el.className.split(/\s+/).filter(Boolean);
}

/** Every element in `root` whose own text is exactly `text`. */
function textEls(root: HTMLElement, text: string): HTMLElement[] {
    return within(root).getAllByText((_, el) => el?.textContent === text && el.children.length === 0);
}

describe('SuggestedGroupCard role labels (A)', () => {
    it('compact (widget): the T/H/D letter is visible at every width, never lg:hidden', () => {
        const card = renderCard();
        const letter = textEls(card, 'T')[0];
        expect(letter, 'a visible "T" role letter').toBeDefined();
        const cls = classesOf(letter ?? card);
        expect(cls, 'the role letter must not hide at lg (no role text would render)').not.toContain('lg:hidden');
        expect(cls, 'the role letter must not be sr-only').not.toContain('sr-only');
    });

    it('wide (planner section): the full role shows at lg and is never sr-only + lg:not-sr-only', () => {
        const card = renderCard('wide');
        const full = textEls(card, 'Tank').map(classesOf);
        expect(full.some((c) => c.includes('lg:block') && !c.includes('sr-only')),
            `a visible "Tank" label from lg — got ${JSON.stringify(full)}`).toBe(true);
        expect(full.every((c) => !c.includes('lg:not-sr-only')), 'lg:not-sr-only loses to the unlayered .sr-only').toBe(true);
    });
});

describe('SuggestedGroupCard member names (B)', () => {
    it('the name truncates inside a wrapping min-w-0 cell shared with the Unclaimed chip; the level never shrinks', () => {
        const card = renderCard();
        const row = within(card).getAllByTestId('suggested-group-member').find((li) => li.textContent?.includes('Frosty'));
        expect(row, 'the unclaimed Frosty row').toBeDefined();
        const name = within(row ?? card).getByText('Frosty');
        expect(classesOf(name)).toEqual(expect.arrayContaining(['truncate', 'min-w-0']));
        const cell = name.closest('[data-testid="suggested-group-member-name-cell"]');
        expect(cell, 'name + chip share one name cell').not.toBeNull();
        expect(classesOf(cell ?? name), 'the cell wraps the chip below a long name instead of crushing it')
            .toEqual(expect.arrayContaining(['flex-wrap', 'min-w-0', 'flex-1']));
        expect(within(row ?? card).getByText('Unclaimed').closest('[data-testid="suggested-group-member-name-cell"]')).toBe(cell);
        expect(classesOf(within(row ?? card).getByText('21'))).toContain('shrink-0');
    });
});

describe('SuggestedGroupCard layout (C)', () => {
    it('wide: members are a 5-column grid from lg; compact stays a vertical list', () => {
        const wide = renderCard('wide');
        expect(classesOf(within(wide).getByRole('list'))).toEqual(expect.arrayContaining(['lg:grid', 'lg:grid-cols-5']));
    });

    it('compact: the member list never becomes a grid', () => {
        const card = renderCard();
        expect(classesOf(within(card).getByRole('list'))).not.toContain('lg:grid');
    });

    it('Schedule is the primary action', () => {
        const card = renderCard();
        const primary = classesOf({ className: buttonClass({ variant: 'primary', size: 'sm' }) } as Element);
        expect(classesOf(within(card).getByTestId('suggested-group-schedule'))).toEqual(expect.arrayContaining(primary));
    });
});
