/**
 * Layout pieces every "GG <year>" card shares (ROK-2187, mockup
 * `design-ROK-2187/gg-2026-mockup.html`). Tokens only — both colour families.
 */
import { useRef, type JSX, type ReactNode } from 'react';
import { useOverflows } from './use-overflows';

const CENTERED = 'items-center text-center [&>*:first-child]:mt-auto [&>*:last-child]:mb-auto';

/**
 * The card column. The story's slide body already pads the stage, so this adds
 * none of its own; it fills what is left and scrolls when a card is taller than
 * a short viewport (375×667, landscape phone). Slide content ignores pointers so
 * empty space pages the story — the body takes them back only while it
 * overflows, so it can be scrolled to the controls at the bottom.
 */
export function GgCardBody({ children, center = false }: { children: ReactNode; center?: boolean }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const scrollable = useOverflows(ref);
    return (
        <div ref={ref} data-testid="gg-card-body" data-scrollable={scrollable}
            className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain [@media(min-height:760px)]:pt-6 ${scrollable ? 'pointer-events-auto' : ''} ${center ? CENTERED : ''}`}>
            {children}
        </div>
    );
}

/** Small uppercase label above the headline. */
export function GgKicker({ children }: { children: ReactNode }): JSX.Element {
    return <p className="text-xs font-semibold uppercase tracking-widest text-muted">{children}</p>;
}

/** Card headline. */
export function GgTitle({ children, display = false }: { children: ReactNode; display?: boolean }): JSX.Element {
    return <h2 className={`font-bold leading-tight text-foreground ${display ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl'}`}>{children}</h2>;
}

/** The giant number. */
export function GgHuge({ children }: { children: ReactNode }): JSX.Element {
    return <p className="text-7xl font-black leading-none text-foreground motion-safe:animate-[story-slide-in_0.5s_var(--spring-smooth)_both] sm:text-8xl">{children}</p>;
}

/** Body line. */
export function GgLede({ children }: { children: ReactNode }): JSX.Element {
    return <p className="text-base text-secondary [&_strong]:font-semibold [&_strong]:text-foreground">{children}</p>;
}

/** One figure in a stat grid. */
export function GgStat({ value, label }: { value: ReactNode; label: string }): JSX.Element {
    return (
        <div className="rounded-xl border border-edge bg-panel/80 p-3">
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted">{label}</p>
        </div>
    );
}

/** Two-column stat grid. */
export function GgStats({ children }: { children: ReactNode }): JSX.Element {
    return <div className="grid w-full grid-cols-2 gap-2">{children}</div>;
}

/** A pill under the stats. */
export function GgChip({ children }: { children: ReactNode }): JSX.Element {
    return <span className="inline-flex w-fit items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-sm text-secondary">{children}</span>;
}

/** Ranked list row (top games, people). */
export function GgRankRow({ rank, name, value }: { rank: number; name: string; value: string }): JSX.Element {
    return (
        <li className="flex items-center gap-3 rounded-lg bg-panel/80 px-3 py-2">
            <span className="w-5 text-sm font-bold text-muted">{rank}</span>
            <span className="flex-1 truncate font-medium text-foreground">{name}</span>
            <span className="text-sm text-secondary">{value}</span>
        </li>
    );
}
