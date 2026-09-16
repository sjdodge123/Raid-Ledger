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

    // ROK-1500: on a phone the badge text + (participants + pill + the three
    // stacked scheduling actions) exceed the card width. The badge row must
    // be allowed to wrap so the action cluster drops onto its own line inside
    // the card, and the cluster itself must wrap/shrink rather than being
    // pinned at max-content (flex-shrink-0) and hanging past the card edge.
    it('badge row wraps and the action cluster is not pinned at max-content (ROK-1500)', () => {
        renderWithProviders(
            <JourneyHero
                phase="scheduling"
                noRibbon
                badge="🗓 Scheduling Poll · started by Somebody Longname"
                task="t"
                headerAction={<button type="button">Cancel Poll</button>}
            />,
        );
        const region = screen.getByRole('region');
        const badgeEl = document.getElementById(
            region.getAttribute('aria-labelledby') as string,
        ) as HTMLElement;
        const badgeRow = badgeEl.parentElement as HTMLElement;
        const cluster = screen.getByRole('button', { name: 'Cancel Poll' })
            .parentElement as HTMLElement;
        expect(badgeRow).toHaveClass('flex', 'flex-wrap');
        expect(cluster).toHaveClass('flex-wrap', 'ml-auto');
        expect(cluster).not.toHaveClass('flex-shrink-0');
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

// ROK-1584 (H1-b): the hero is relaid out — badge line, then a headline row
// carrying the ✓ disc + the `action` chip on the right, then a 4px progress
// bar + "Nominate · Vote · Decide · Schedule / step N of 4" line (replacing
// the dot ribbon's visuals while keeping its list semantics), then the
// existing cta/hint/exit/cue lines, then a new full-width `manage` slot.
describe('JourneyHero — H1-b relayout (ROK-1584)', () => {
    it('renders a ✓ disc in the headline row when the viewer is done', () => {
        renderWithProviders(
            <JourneyHero phase="voting" tone="waiting" badge="b" task="Your votes are in." />,
        );
        const disc = screen.getByTestId('journey-done-check');
        expect(disc).toHaveTextContent('✓');
        // The disc sits inside the headline row, before the task copy.
        expect(disc.parentElement?.textContent).toContain('Your votes are in.');
        // The label survives for screen readers (and the composites' assertions).
        expect(screen.getByText("✓ You're done here")).toBeInTheDocument();
    });

    it('renders no ✓ disc for tone="action" without a donePillLabel', () => {
        renderWithProviders(<JourneyHero phase="voting" badge="b" task="Vote now." />);
        expect(screen.queryByTestId('journey-done-check')).not.toBeInTheDocument();
    });

    it('puts the `action` chip on the RIGHT of the headline row', () => {
        renderWithProviders(
            <JourneyHero
                phase="scheduling"
                badge="b"
                task="Pick the times you can make."
                action={<button type="button">Participants, 4</button>}
            />,
        );
        const row = screen.getByTestId('journey-headline-row');
        expect(row).toHaveClass('flex', 'items-start', 'gap-2');
        const headline = screen.getByText('Pick the times you can make.');
        const chip = screen.getByRole('button', { name: 'Participants, 4' });
        expect(row).toContainElement(chip);
        expect(row).toContainElement(headline);
        // headline block first (flex-1 min-w-0), chip after it.
        const blocks = Array.from(row.children);
        expect(blocks[0].contains(headline)).toBe(true);
        expect(blocks[blocks.length - 1].contains(chip)).toBe(true);
        expect(blocks[0]).toHaveClass('flex-1', 'min-w-0');
    });

    it.each([
        ['nominating', '25%', 0],
        ['voting', '50%', 1],
        ['decided', '75%', 2],
        ['scheduling', '100%', 3],
    ] as const)('phase=%s fills the progress bar to %s', (phase, width, active) => {
        renderWithProviders(<JourneyHero phase={phase} badge="b" task="t" />);
        expect(screen.getByTestId('journey-progress-fill')).toHaveStyle({ width });
        expect(screen.getByTestId('journey-progress')).toHaveAttribute('data-active', String(active));
    });

    it('renders the phase line with the current phase emphasised and "step N of 4"', () => {
        renderWithProviders(<JourneyHero phase="decided" badge="b" task="t" />);
        const line = screen.getByTestId('journey-progress');
        expect(line.textContent?.replace(/\s+/g, ' ')).toContain('Decide');
        const current = line.querySelector('[aria-current="step"]') as HTMLElement;
        expect(current.textContent).toContain('Decide');
        expect(current).toHaveClass('font-semibold', 'text-foreground');
        expect(screen.getByText('step 3 of 4')).toBeInTheDocument();
    });

    it('hideSchedulePhase drops Schedule and reads "step N of 3"', () => {
        renderWithProviders(<JourneyHero phase="decided" badge="b" task="t" hideSchedulePhase />);
        const line = screen.getByTestId('journey-progress');
        expect(line.querySelectorAll('li')).toHaveLength(3);
        expect(line.textContent).not.toContain('Schedule');
        expect(screen.getByText('step 3 of 3')).toBeInTheDocument();
    });

    it('noRibbon renders neither the bar nor the phase line', () => {
        renderWithProviders(<JourneyHero phase="scheduling" badge="b" task="t" noRibbon />);
        expect(screen.queryByTestId('journey-progress')).not.toBeInTheDocument();
        expect(screen.queryByTestId('journey-progress-fill')).not.toBeInTheDocument();
    });

    it('uses the emerald fill for tone="action" and the neutral fill otherwise', () => {
        const { unmount } = renderWithProviders(<JourneyHero phase="voting" badge="b" task="t" />);
        expect(screen.getByTestId('journey-progress-fill')).toHaveClass('bg-emerald-500');
        unmount();
        renderWithProviders(<JourneyHero phase="voting" tone="waiting" badge="b" task="t" />);
        expect(screen.getByTestId('journey-progress-fill')).toHaveClass('bg-edge-strong');
    });

    it('renders the `manage` slot LAST, full width', () => {
        renderWithProviders(
            <JourneyHero
                phase="scheduling"
                badge="b"
                task="t"
                cue="We'll DM you when events are locked."
                manage={<button type="button">Manage poll</button>}
            />,
        );
        const region = screen.getByRole('region');
        const slot = screen.getByTestId('journey-manage');
        expect(region.lastElementChild).toBe(slot);
        expect(slot).toContainElement(screen.getByRole('button', { name: 'Manage poll' }));
        expect(slot).toHaveClass('w-full');
    });

    it('omits the manage slot when no `manage` node is passed', () => {
        renderWithProviders(<JourneyHero phase="scheduling" badge="b" task="t" />);
        expect(screen.queryByTestId('journey-manage')).not.toBeInTheDocument();
    });
});

// ROK-1585 (desktop round, §5): the headline keeps ≥56% of the card from `lg`
// and the chip + the phase's ONE control share a ≤44% cluster that wraps first.
// jsdom has no layout — these are class-level; Lane G's Playwright measures.
describe('JourneyHero — desktop controls cluster (ROK-1585)', () => {
    function renderScheduling(extra: { headerAction?: boolean; manage?: boolean } = {}): void {
        renderWithProviders(
            <JourneyHero
                phase="scheduling"
                badge="b"
                task="Pick the times you can make."
                action={<button type="button">Participants, 4</button>}
                headerAction={extra.headerAction ? <button type="button">Manage poll</button> : undefined}
                manage={extra.manage ? <button type="button">Manage sheet</button> : undefined}
            />,
        );
    }

    it('headline column keeps ≥56% from lg and never shrinks; the row wraps only below lg', () => {
        renderScheduling();
        const headline = screen.getByTestId('journey-headline');
        expect(headline).toHaveClass('flex-1', 'min-w-0', 'lg:basis-[56%]', 'lg:shrink-0');
        expect(headline).toContainElement(screen.getByText('Pick the times you can make.'));
        expect(screen.getByTestId('journey-headline-row')).toHaveClass('flex-wrap', 'lg:flex-nowrap');
    });

    it('controls cluster is capped at 44%, wraps, and holds the chip then headerAction', () => {
        renderScheduling({ headerAction: true });
        const cluster = screen.getByTestId('journey-controls');
        expect(cluster).toHaveClass('flex', 'flex-wrap', 'justify-end', 'min-w-0', 'lg:max-w-[44%]');
        const chip = screen.getByRole('button', { name: 'Participants, 4' });
        const control = screen.getByRole('button', { name: 'Manage poll' });
        expect(Array.from(cluster.children)).toEqual([chip, control]);
        expect(screen.getByTestId('journey-headline-row')).toContainElement(cluster);
    });

    it('renders no separate headerAction cluster outside the headline row', () => {
        renderScheduling({ headerAction: true });
        const row = screen.getByTestId('journey-headline-row');
        // Next sibling of the row is the progress block, not a cluster div.
        expect(row.nextElementSibling).toContainElement(screen.getByTestId('journey-progress'));
        expect(screen.getAllByRole('button', { name: 'Manage poll' })).toHaveLength(1);
    });

    it('phone-neutral: with no headerAction the cluster holds only the chip and does not shrink below lg', () => {
        renderScheduling();
        const cluster = screen.getByTestId('journey-controls');
        expect(cluster.children).toHaveLength(1);
        expect(cluster).toHaveClass('flex-none', 'lg:flex-initial');
    });

    it('omits the cluster when there is neither action nor headerAction', () => {
        renderWithProviders(<JourneyHero phase="voting" badge="b" task="t" />);
        expect(screen.queryByTestId('journey-controls')).not.toBeInTheDocument();
    });
});
