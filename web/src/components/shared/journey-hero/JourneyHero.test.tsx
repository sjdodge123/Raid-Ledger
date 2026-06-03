/**
 * Failing-first tests for JourneyHero component (ROK-1294).
 * Source file does not yet exist — these MUST fail with module-not-found until dev implements.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/render-helpers';
import { JourneyHero } from './JourneyHero';
import type { HeroTone, JourneyPhase } from './types';

const PHASES: JourneyPhase[] = ['nominating', 'voting', 'decided', 'scheduling', 'done'];
const TONES: HeroTone[] = ['action', 'waiting', 'set'];

function pillLabelFor(tone: HeroTone): string | null {
    if (tone === 'waiting') return "✓ You're done here";
    if (tone === 'set') return "✓ You're set";
    return null;
}

describe('JourneyHero — 5 phases × 3 tones smoke', () => {
    for (const phase of PHASES) {
        for (const tone of TONES) {
            it(`renders phase=${phase} tone=${tone} with task, badge, and correct pill`, () => {
                const badge = `BADGE-${phase}-${tone}`;
                const task = `Task copy for ${phase} ${tone}`;
                renderWithProviders(
                    <JourneyHero phase={phase} tone={tone} badge={badge} task={task} />,
                );
                expect(screen.getByText(task)).toBeInTheDocument();
                expect(screen.getByText(badge)).toBeInTheDocument();
                const expectedPill = pillLabelFor(tone);
                if (expectedPill) {
                    expect(screen.getByText(expectedPill)).toBeInTheDocument();
                } else {
                    expect(screen.queryByText("✓ You're done here")).not.toBeInTheDocument();
                    expect(screen.queryByText("✓ You're set")).not.toBeInTheDocument();
                }
            });
        }
    }
});

describe('JourneyHero — ribbon visibility', () => {
    it('noRibbon=true hides the phase ribbon <ol>', () => {
        renderWithProviders(
            <JourneyHero phase="nominating" badge="b" task="t" noRibbon />,
        );
        expect(screen.queryByRole('list', { name: 'Lineup progress' })).not.toBeInTheDocument();
    });

    it('noRibbon unset renders <ol aria-label="Lineup progress"> with exactly 4 phase <li> items', () => {
        renderWithProviders(<JourneyHero phase="nominating" badge="b" task="t" />);
        const ribbon = screen.getByRole('list', { name: 'Lineup progress' });
        expect(ribbon).toBeInTheDocument();
        // 4 named phases: Nominate / Vote / Decide / Schedule
        const items = ribbon.querySelectorAll('li');
        expect(items.length).toBe(4);
    });
});

describe('JourneyHero — pill override', () => {
    it('donePillLabel overrides the tone-derived default', () => {
        renderWithProviders(
            <JourneyHero phase="done" tone="set" badge="b" task="t" donePillLabel="✓ Custom label" />,
        );
        expect(screen.getByText('✓ Custom label')).toBeInTheDocument();
        expect(screen.queryByText("✓ You're set")).not.toBeInTheDocument();
    });
});

describe('JourneyHero — headerAction (ROK-1300)', () => {
    it('renders headerAction on the badge row alongside the done-pill', () => {
        renderWithProviders(
            <JourneyHero
                phase="scheduling"
                tone="waiting"
                badge="Step 4 of 4 · Scheduling"
                task="t"
                headerAction={<button type="button">Cancel Poll</button>}
            />,
        );
        // Both the tone-derived done-pill and the action render.
        expect(screen.getByText("✓ You're done here")).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Cancel Poll' }),
        ).toBeInTheDocument();
    });

    it('omits the right-side wrapper when neither pill nor headerAction is present', () => {
        renderWithProviders(
            <JourneyHero phase="nominating" badge="b" task="t" />,
        );
        expect(
            screen.queryByRole('button', { name: 'Cancel Poll' }),
        ).not.toBeInTheDocument();
    });
});

describe('JourneyHero — CTA', () => {
    it('renders a real <button>; clicking calls onCtaClick', async () => {
        const onCtaClick = vi.fn();
        renderWithProviders(
            <JourneyHero phase="nominating" badge="b" task="t" cta="Nominate now" onCtaClick={onCtaClick} />,
        );
        const btn = screen.getByRole('button', { name: 'Nominate now' });
        expect(btn).toBeInTheDocument();
        await userEvent.click(btn);
        expect(onCtaClick).toHaveBeenCalledTimes(1);
    });

    it('renders a disabled button when cta is set but onCtaClick is omitted', () => {
        renderWithProviders(
            <JourneyHero phase="nominating" badge="b" task="t" cta="Disabled CTA" />,
        );
        const btn = screen.getByRole('button', { name: 'Disabled CTA' });
        expect(btn).toBeDisabled();
    });
});

describe('JourneyHero — exitCondition + cue', () => {
    it('renders exitCondition when provided', () => {
        renderWithProviders(
            <JourneyHero
                phase="nominating"
                tone="waiting"
                badge="b"
                task="t"
                exitCondition="Auto-advances when 15 of 20 have nominated."
            />,
        );
        expect(screen.getByText(/Auto-advances when 15 of 20 have nominated\./)).toBeInTheDocument();
    });

    it('does not render exitCondition when not provided', () => {
        renderWithProviders(<JourneyHero phase="nominating" badge="b" task="t" />);
        expect(screen.queryByText(/Auto-advances/)).not.toBeInTheDocument();
    });

    it('renders cue when provided (with 🔔 prefix)', () => {
        renderWithProviders(
            <JourneyHero
                phase="nominating"
                tone="waiting"
                badge="b"
                task="t"
                cue="We'll DM you when voting opens."
            />,
        );
        expect(screen.getByText(/We'll DM you when voting opens\./)).toBeInTheDocument();
    });

    it('does not render cue when not provided', () => {
        renderWithProviders(<JourneyHero phase="nominating" badge="b" task="t" />);
        expect(screen.queryByText(/DM you/)).not.toBeInTheDocument();
    });
});

describe('JourneyHero — a11y', () => {
    it('phase ribbon: active phase has aria-current="step"; others do not', () => {
        renderWithProviders(<JourneyHero phase="voting" badge="b" task="t" />);
        const ribbon = screen.getByRole('list', { name: 'Lineup progress' });
        const items = Array.from(ribbon.querySelectorAll('li'));
        const current = items.filter((li) => li.getAttribute('aria-current') === 'step');
        expect(current).toHaveLength(1);
        // voting maps to active index 1 (0-based: nominate, vote, decide, schedule)
        expect(items.indexOf(current[0])).toBe(1);
    });

    it('outer container is role="region" with aria-labelledby pointing to badge id', () => {
        renderWithProviders(<JourneyHero phase="nominating" badge="MY BADGE" task="t" />);
        const region = screen.getByRole('region');
        const labelledBy = region.getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        const labelEl = document.getElementById(labelledBy as string);
        expect(labelEl).not.toBeNull();
        expect(labelEl?.textContent).toBe('MY BADGE');
    });

    it('does NOT add role="status" or aria-live to the container or pills', () => {
        renderWithProviders(
            <JourneyHero phase="nominating" tone="waiting" badge="b" task="t" />,
        );
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        const region = screen.getByRole('region');
        expect(region.hasAttribute('aria-live')).toBe(false);
    });
});

describe('JourneyHero — phase prop derivation', () => {
    it('phase="voting" (no active) renders the same ribbon state as active={1}', () => {
        const { unmount } = renderWithProviders(<JourneyHero phase="voting" badge="b" task="t" />);
        const phaseCurrentIdx = Array.from(
            screen.getByRole('list', { name: 'Lineup progress' }).querySelectorAll('li'),
        ).findIndex((li) => li.getAttribute('aria-current') === 'step');
        unmount();

        renderWithProviders(<JourneyHero active={1} badge="b" task="t" />);
        const activeCurrentIdx = Array.from(
            screen.getByRole('list', { name: 'Lineup progress' }).querySelectorAll('li'),
        ).findIndex((li) => li.getAttribute('aria-current') === 'step');

        expect(phaseCurrentIdx).toBe(activeCurrentIdx);
        expect(phaseCurrentIdx).toBe(1);
    });
});
