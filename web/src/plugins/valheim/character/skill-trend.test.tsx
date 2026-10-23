/** ROK-1882 — the Skills section's trend chip, dots and detail toggle (AC 8, 10, 11). */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
    valheimSheetFixture,
    valheimSkillTrend,
} from '../../../test/mocks/valheim-armory-handlers';
import { SkillsSection } from './skills-section';

function row(skillId: string): HTMLElement {
    const li = document.querySelector<HTMLElement>(`li[data-skill="${skillId}"]`);
    if (!li) throw new Error(`no row for ${skillId}`);
    return li;
}

describe('SkillsSection trend chip', () => {
    it('renders the chip with the full sentence as its name and three aria-hidden dots', () => {
        render(<SkillsSection character={valheimSheetFixture({ skillTrend: valheimSkillTrend })} />);
        const chip = within(row('Swords')).getByRole('button', {
            name: '+4.1 over 3 sessions: +2.0 on Oct 20, +1.6 on Oct 18, +0.5 on Oct 15',
        });
        expect(chip).toHaveTextContent('+4.1 over 3 sessions');
        expect(chip).toHaveAttribute('data-tone', 'success');
        expect(chip).toHaveAttribute('title', 'Oct 20 +2.0 · Oct 18 +1.6 · Oct 15 +0.5');
        const dots = within(chip).getByTestId('skill-trend-dots');
        expect(dots).toHaveAttribute('aria-hidden', 'true');
        expect(dots.children).toHaveLength(3);
    });

    it('toggles the detail line and aria-expanded on click', () => {
        render(<SkillsSection character={valheimSheetFixture({ skillTrend: valheimSkillTrend })} />);
        const chip = within(row('Swords')).getByRole('button');
        const detailId = chip.getAttribute('aria-controls') ?? '';
        const detail = document.getElementById(detailId);
        expect(detail).not.toBeNull();
        expect(chip).toHaveAttribute('aria-expanded', 'false');
        expect(detail).not.toBeVisible();
        fireEvent.click(chip);
        expect(chip).toHaveAttribute('aria-expanded', 'true');
        expect(detail).toBeVisible();
        expect(detail).toHaveTextContent('Oct 20 +2.0 · Oct 18 +1.6 · Oct 15 +0.5');
        fireEvent.click(chip);
        expect(chip).toHaveAttribute('aria-expanded', 'false');
    });

    it('paints a net loss in the danger tone with the U+2212 minus', () => {
        render(<SkillsSection character={valheimSheetFixture({ skillTrend: valheimSkillTrend })} />);
        const chip = within(row('-1287461328')).getByRole('button');
        expect(chip).toHaveTextContent('−1.2 over 3 sessions');
        expect(chip).toHaveAttribute('data-tone', 'danger');
        expect(chip.className).toContain('text-danger');
        expect(chip.className).not.toContain('text-success');
    });

    it('colours each dot by its own day, not the chip tone: a gain day stays filled success inside a danger chip (spec §5/Q3)', () => {
        render(<SkillsSection character={valheimSheetFixture({ skillTrend: valheimSkillTrend })} />);
        const chip = within(row('-1287461328')).getByRole('button');
        const dots = Array.from(within(chip).getByTestId('skill-trend-dots').children);
        // Oldest → newest: Oct 15 no change, Oct 18 +0.3, Oct 20 −1.5.
        expect(dots.map((d) => d.getAttribute('data-filled'))).toEqual(['false', 'true', 'false']);
        expect(dots[1]?.className).toContain('bg-success');
        expect(dots[2]?.className).toContain('border-edge-strong');
        expect(dots[2]?.className).not.toContain('bg-danger');
    });

    it('renders no chip with empty days, and none when skillTrend is absent', () => {
        const { unmount } = render(<SkillsSection character={valheimSheetFixture({ skillTrend: { days: [] } })} />);
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.getAllByRole('meter')).toHaveLength(3);
        unmount();
        render(<SkillsSection character={valheimSheetFixture()} />);
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.getAllByRole('meter')).toHaveLength(3);
    });
});
