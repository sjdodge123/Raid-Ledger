/** Week-at-a-glance strip for the phone week editor (ROK-1569). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { WeekStrip } from '../WeekStrip';
import { GROUP_FILL, GROUP_GRADIENT } from '../week-strip.fills';

const HOURS = [17, 18, 19, 20, 21, 22, 23];
const avail = (day: number, hours: number[]): GameTimeSlot[] =>
    hours.map((h) => ({ dayOfWeek: day, hour: h, status: 'available' as const }));

const renderStrip = (over: Partial<Parameters<typeof WeekStrip>[0]> = {}) =>
    render(
        <WeekStrip
            slots={avail(2, [19, 20, 21, 22])}
            hours={HOURS}
            day={2}
            onPick={vi.fn()}
            {...over}
        />,
    );

describe('WeekStrip', () => {
    it('offers all seven days as buttons that say how free they are', () => {
        renderStrip();
        expect(screen.getAllByRole('button')).toHaveLength(7);
        expect(screen.getByLabelText('Tuesday, 4 hours free')).toBeInTheDocument();
        expect(screen.getByLabelText('Monday, no hours free')).toBeInTheDocument();
    });

    it('marks the day being edited as current', () => {
        renderStrip();
        expect(screen.getByTestId('phone-week-strip-day-2')).toHaveAttribute('aria-current', 'date');
        expect(screen.getByTestId('phone-week-strip-day-3')).not.toHaveAttribute('aria-current');
    });

    it('jumps to the tapped day', () => {
        const onPick = vi.fn();
        renderStrip({ onPick });
        fireEvent.click(screen.getByTestId('phone-week-strip-day-5'));
        expect(onPick).toHaveBeenCalledWith(5);
    });

    // ROK-1579 (operator ruling 2026-09-16): three bars per day, not one per
    // hour — day 9 AM–5 PM, evening 5–9 PM, late 9 PM–1 AM, each filled by the
    // share of that band the viewer has claimed.
    it('draws exactly three band bars per day', () => {
        renderStrip();
        expect(document.querySelectorAll('[data-testid="phone-week-strip-bar"]')).toHaveLength(21);
        for (let d = 0; d < 7; d++) {
            const bars = screen.getByTestId(`phone-week-strip-day-${d}`)
                .querySelectorAll('[data-testid="phone-week-strip-bar"]');
            expect(bars).toHaveLength(3);
            expect([...bars].map((b) => b.getAttribute('data-band')))
                .toEqual(['day', 'evening', 'late']);
        }
    });

    it('fills each band by the share of it the viewer has claimed', () => {
        // The fixture claims Tuesday 7–11 PM (19, 20, 21, 22): nothing in the
        // daytime band, half the evening band, half the late band.
        renderStrip();
        const kinds = (d: number): (string | null)[] =>
            [...screen.getByTestId(`phone-week-strip-day-${d}`)
                .querySelectorAll('[data-testid="phone-week-strip-bar"]')]
                .map((b) => b.getAttribute('data-kind'));
        expect(kinds(2)).toEqual(['none', 'partial', 'partial']);
        expect(kinds(3)).toEqual(['none', 'none', 'none']);
    });

    it('marks a wholly claimed band as full', () => {
        renderStrip({ slots: avail(4, [17, 18, 19, 20]) });
        const bars = [...screen.getByTestId('phone-week-strip-day-4')
            .querySelectorAll('[data-testid="phone-week-strip-bar"]')]
            .map((b) => b.getAttribute('data-kind'));
        expect(bars).toEqual(['none', 'full', 'none']);
    });

    // ROK-1579 (operator ruling 2026-09-16: "I don't like the cross-hatch
    // visual"): the bars are flat fills — no hatched stale bar, on any week.
    // The staleness the copy names is the prompt's job.
    it('never hatches a bar — the unclaimed bands are plain edges', () => {
        renderStrip();
        const bars = [...document.querySelectorAll<HTMLElement>('[data-testid="phone-week-strip-bar"]')];
        expect(bars.length).toBe(21);
        expect(bars.filter((b) => b.getAttribute('data-kind') === 'stale')).toHaveLength(0);
        expect(bars.every((b) => !b.style.backgroundImage)).toBe(true);
    });

    // The strip summarises the WHOLE day: it must not shrink to the hours the
    // editor happens to show, or the profile's fitted window would hide the
    // daytime a shift worker just saved.
    it('summarises the whole day whatever hours the editor shows', () => {
        renderStrip({ hours: [17, 18, 19], slots: avail(4, [9, 10, 11, 12, 13, 14, 15, 16]) });
        const bars = [...screen.getByTestId('phone-week-strip-day-4')
            .querySelectorAll('[data-testid="phone-week-strip-bar"]')]
            .map((b) => b.getAttribute('data-kind'));
        expect(bars).toEqual(['full', 'none', 'none']);
    });
});

// ROK-1579: while the strip was being squeezed by the flex column, the
// `aria-current` column rendered full height and the other six were clipped.
// Nothing in the markup may make the selected column a different SIZE — the
// only difference between columns is colour.
describe('WeekStrip — every column is the same size', () => {
    it('differs between the selected day and the rest by colour alone', () => {
        renderStrip();
        const layout = (d: number): string[] =>
            screen.getByTestId(`phone-week-strip-day-${d}`).className
                .split(/\s+/)
                .filter((c) => c && !c.startsWith('border-') && !c.startsWith('bg-'))
                .sort();
        const first = layout(0);
        expect(first).toContain('p-1');
        for (let d = 1; d < 7; d++) expect(layout(d)).toEqual(first);
    });

    it('never sizes a column with a height or self-alignment class', () => {
        renderStrip();
        for (let d = 0; d < 7; d++) {
            const classes = screen.getByTestId(`phone-week-strip-day-${d}`).className.split(/\s+/);
            expect(classes.filter((c) => /^(h-|min-h-|max-h-|self-)/.test(c))).toEqual([]);
        }
    });
});
// ROK-1580: the same strip, reading the GROUP instead of the viewer — three
// kinds of "how free is everyone" rather than "how much have I claimed".
// ROK-1584 gave each band a second tone and a busy cap.
describe('WeekStrip — group mode', () => {
    const band = (best: number, other: number | null = null, busy = false) => ({ best, other, busy });
    const BANDS = [
        [band(0), band(0), band(0)],
        [band(0), band(0.25), band(0)],
        [band(0), band(0.75, 0.25), band(0.25)],
        [band(0), band(1), band(0, null, true)],
        [band(0), band(0), band(0)],
        [band(0), band(0), band(0)],
        [band(0), band(0), band(0)],
    ];

    const renderGroup = () => renderStrip({ groupBands: BANDS.map((b) => [...b]) });
    const bars = (d: number): HTMLElement[] => [...screen.getByTestId(`phone-week-strip-day-${d}`)
        .querySelectorAll<HTMLElement>('[data-testid="phone-week-strip-bar"]')];

    it('fills the bands from the group’s kinds', () => {
        renderGroup();
        expect(bars(2).map((b) => b.getAttribute('data-kind'))).toEqual(['none', 'most', 'few']);
        // ROK-1586: the ramp reads through the semantic tokens, not raw hues.
        expect(bars(2)[2].className).toContain('bg-danger/50');
        expect(bars(3)[1].className).toContain('bg-success');
    });

    it('splits a band whose hours disagree into two tones, gapped by the surface', () => {
        renderGroup();
        const split = bars(2)[1];
        expect(split).toHaveAttribute('data-two-tone', 'few');
        expect(split.className).toContain('strip-bar-split');
        // The heat colours ride on custom properties so the gradient itself can
        // live in `index.css` next to the rest of the app's CSS (design §2).
        const style = split.getAttribute('style') ?? '';
        expect(style).toContain('--bar-l');
        expect(style).toContain('--bar-r');
        // A single-tone band keeps its flat fill and no gradient.
        expect(bars(2)[2]).not.toHaveAttribute('data-two-tone');
        expect(bars(2)[2].className).not.toContain('strip-bar-split');
    });

    it('caps a band with a busy hour in purple, and only that band', () => {
        renderGroup();
        const cap = bars(3)[2].querySelector('[data-busy]');
        expect(cap).not.toBeNull();
        expect(cap?.className).toContain('bg-busy');
        expect(cap?.className).toContain('w-[30%]');
        expect(bars(3)[1].querySelector('[data-busy]')).toBeNull();
    });

    it('never caps or splits the viewer’s own week', () => {
        renderStrip();
        expect(document.querySelector('[data-busy]')).toBeNull();
        expect(document.querySelector('[data-two-tone]')).toBeNull();
    });

    it('says how free the group is rather than how free the viewer is', () => {
        renderGroup();
        expect(screen.getByLabelText('Tuesday, evening: most to a few free')).toBeInTheDocument();
        expect(screen.getByLabelText('Wednesday, evening: everyone free, busy')).toBeInTheDocument();
        expect(screen.getByLabelText('Friday, nobody free')).toBeInTheDocument();
    });
});
// ROK-1585 (Q1): a day the viewer is away reads as a dashed "away" tile — the
// band bars give way to the word, and nothing hatches or gradients.
describe('WeekStrip — away days', () => {
    const column = (d: number): HTMLElement => screen.getByTestId(`phone-week-strip-day-${d}`);
    const bars = (d: number) => column(d).querySelectorAll('[data-testid="phone-week-strip-bar"]');

    it('marks an away day dashed, with an "away" label in place of its bars', () => {
        renderStrip({ awayDays: new Set([0, 6]) });
        expect(column(6)).toHaveAttribute('data-away', 'true');
        expect(column(6).className).toContain('border-dashed');
        expect(column(6).className).toContain('border-edge-strong');
        expect(column(6).className).toContain('bg-overlay/40');
        expect(bars(6)).toHaveLength(0);
        expect(column(6)).toHaveTextContent(/away/i);
        expect(column(6).querySelector('[data-testid="phone-week-strip-away"]')?.className)
            .toContain('text-muted');
        expect(column(1)).not.toHaveAttribute('data-away');
        expect(bars(1)).toHaveLength(3);
    });

    it('says the day is away in its accessible name', () => {
        renderStrip({ awayDays: new Set([6]) });
        expect(screen.getByLabelText('Saturday, no hours free, away')).toBeInTheDocument();
        expect(screen.getByLabelText('Tuesday, 4 hours free')).toBeInTheDocument();
    });

    it('never hatches or gradients an away tile', () => {
        renderStrip({ awayDays: new Set([6]) });
        expect(column(6).getAttribute('style')).toBeNull();
        expect(column(6).innerHTML).not.toMatch(/gradient|hatch|strip-bar-split/);
    });

    it('keeps the selected state on a selected day that is away', () => {
        renderStrip({ awayDays: new Set([2]) });
        expect(column(2)).toHaveAttribute('aria-current', 'date');
        expect(column(2)).toHaveAttribute('data-away', 'true');
        expect(column(2).className).toContain('border-dashed');
        expect(column(2).className).toContain('border-success');
        expect(column(2).className).not.toContain('border-edge-strong');
    });

    it('lays an away column out like the others (colour and border style only)', () => {
        renderStrip({ awayDays: new Set([4]) });
        const layout = (d: number): string[] => column(d).className.split(/\s+/)
            .filter((c) => c && !c.startsWith('border-') && !c.startsWith('bg-')).sort();
        expect(layout(4)).toEqual(layout(3));
    });

    it('ignores away days in group mode', () => {
        const none = { best: 0, other: null, busy: false };
        renderStrip({
            awayDays: new Set([6]),
            groupBands: Array.from({ length: 7 }, () => [none, none, none]),
        });
        expect(column(6)).not.toHaveAttribute('data-away');
        expect(bars(6)).toHaveLength(3);
        expect(screen.getByLabelText('Saturday, nobody free')).toBeInTheDocument();
    });
});
// ROK-1587 (board P-a): in group mode each column carries "● N" under its
// letter — the poll slots already starting that day — and says so aloud.
describe('WeekStrip — vote markers (group mode)', () => {
    const none = { best: 0, other: null, busy: false };
    const GROUP = Array.from({ length: 7 }, () => [none, none, none]);
    const VOTES = [0, 0, 0, 2, 0, 1, 0];
    const column = (d: number): HTMLElement => screen.getByTestId(`phone-week-strip-day-${d}`);
    const marker = (d: number) => column(d).querySelector<HTMLElement>('[data-testid="phone-week-strip-votes"]');
    const renderVotes = () => renderStrip({ groupBands: GROUP, groupVotes: VOTES });

    it('shows "● 2" under the letter of a day with two slots, in the slot colour', () => {
        renderVotes();
        expect(marker(3)).toHaveTextContent('● 2');
        expect(marker(3)?.className).toContain('text-slot');
        expect(marker(3)).toHaveAttribute('aria-hidden', 'true');
        expect(marker(5)).toHaveTextContent('● 1');
    });

    it('keeps an empty 10px spacer on every day without slots', () => {
        renderVotes();
        expect(screen.getAllByTestId('phone-week-strip-votes')).toHaveLength(7);
        for (const d of [0, 1, 2, 4, 6]) {
            expect(marker(d)?.textContent).toBe('');
            expect(marker(d)?.className).toContain('h-[10px]');
        }
    });

    it('lays every column out alike — only border and fill differ (ROK-1579)', () => {
        renderVotes();
        const layout = (d: number): string[] => column(d).className.split(/\s+/)
            .filter((c) => c && !c.startsWith('border-') && !c.startsWith('bg-')).sort();
        for (let d = 1; d < 7; d++) expect(layout(d)).toEqual(layout(0));
        const markerClasses = (d: number) => marker(d)?.className;
        for (let d = 1; d < 7; d++) expect(markerClasses(d)).toEqual(markerClasses(0));
    });

    it('appends the suggested times to the column label', () => {
        renderVotes();
        expect(column(3)).toHaveAttribute('aria-label', 'Wednesday, nobody free, 2 suggested times');
        expect(column(5)).toHaveAttribute('aria-label', 'Friday, nobody free, 1 suggested time');
        expect(column(0)).toHaveAttribute('aria-label', 'Sunday, nobody free');
    });

    it('renders empty spacers in group mode even without vote counts', () => {
        renderStrip({ groupBands: GROUP });
        expect(screen.getAllByTestId('phone-week-strip-votes')).toHaveLength(7);
        expect(column(3)).toHaveAttribute('aria-label', 'Wednesday, nobody free');
    });

    it("never marks votes on the viewer's own week", () => {
        renderStrip({ groupVotes: VOTES });
        expect(screen.queryByTestId('phone-week-strip-votes')).toBeNull();
        expect(column(3).getAttribute('aria-label')).not.toContain('suggested');
    });
});
// ROK-1586: `GROUP_FILL` (Tailwind classes) and `GROUP_GRADIENT` (CSS values for
// the two-tone split) paint the SAME ramp in two spellings. A class-string update
// that forgets the gradient map desynchronises a solid bar from its two-tone twin
// and nothing else in the suite would notice — so compare them token by token.
describe('WeekStrip — GROUP_FILL / GROUP_GRADIENT token parity', () => {
    /** `bg-warning/70` → `{ token: 'warning', alpha: 70 }`. */
    const tokenOfClass = (cls: string): { token: string; alpha: number } => {
        const m = /^bg-([a-z-]+)(?:\/(\d+))?$/.exec(cls);
        if (!m) throw new Error(`GROUP_FILL entry "${cls}" is not a bg-<token>[/alpha] class`);
        return { token: m[1], alpha: m[2] === undefined ? 100 : Number(m[2]) };
    };

    /** `color-mix(in srgb, var(--color-warning) 70%, transparent)` → the same shape. */
    const tokenOfCss = (value: string): { token: string; alpha: number } => {
        const m = /var\(--color-([a-z-]+)\)(?:\s+(\d+)%)?/.exec(value);
        if (!m) throw new Error(`GROUP_GRADIENT entry "${value}" does not reference a --color-* token`);
        return { token: m[1], alpha: m[2] === undefined ? 100 : Number(m[2]) };
    };

    it('names the same token and alpha for every kind, in both spellings', () => {
        const map = (src: Record<string, string>, read: (v: string) => { token: string; alpha: number }) =>
            Object.fromEntries(Object.entries(src).map(([k, v]) => [k, read(v)]));
        expect(Object.keys(GROUP_GRADIENT).sort()).toEqual(Object.keys(GROUP_FILL).sort());
        expect(map(GROUP_GRADIENT, tokenOfCss)).toEqual(map(GROUP_FILL, tokenOfClass));
    });

    it('never hardcodes a hue — every entry resolves through a token', () => {
        for (const value of Object.values(GROUP_GRADIENT)) {
            expect(value).toMatch(/var\(--color-[a-z-]+\)/);
            expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\b(emerald|amber|red|green|yellow)-\d/i);
        }
    });
});
