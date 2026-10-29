/**
 * ROK-2043 §4.31 demo — the real `useMasonryRows` hook + `MASONRY_GRID_CLASS`
 * over sample cards of mixed height and span (the hub Overview bento). From
 * 768px each card keeps its arranged slot and span and starts right under the
 * card above it: "Upcoming events" (span 2) sits under the Gallery, not below
 * the long Deaths list. Below 768px it is a plain stack. Tokens only.
 */
import { useRef, type JSX } from 'react';
import { MASONRY_GRID_CLASS, useMasonryRows } from '../../components/hub/layout/use-masonry-rows';

interface SampleCard {
    title: string;
    wide: boolean;
    lines: number;
}

const CARDS: readonly SampleCard[] = [
    { title: 'Gallery', wide: true, lines: 3 },
    { title: 'Deaths', wide: false, lines: 9 },
    { title: 'Upcoming events', wide: true, lines: 2 },
    { title: 'Members', wide: false, lines: 4 },
    { title: 'Session note', wide: false, lines: 1 },
];

function DemoCard({ card }: { card: SampleCard }): JSX.Element {
    return (
        <section
            className={`rounded-lg border border-edge bg-panel p-3 ${card.wide ? 'md:col-span-2' : ''}`}
            data-testid="ds-masonry-card"
        >
            <h3 className="text-sm font-semibold text-foreground">
                {card.title} <span className="text-[10px] font-normal text-muted">{card.wide ? 'span 2' : 'span 1'}</span>
            </h3>
            <ul className="mt-2 space-y-1">
                {Array.from({ length: card.lines }, (_, i) => (
                    <li key={i} className="h-3 rounded bg-overlay" aria-hidden />
                ))}
            </ul>
        </section>
    );
}

export default function MasonryGridDemo(): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useMasonryRows(ref);
    return (
        <div ref={ref} className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 ${MASONRY_GRID_CLASS}`}>
            {CARDS.map((c) => <DemoCard key={c.title} card={c} />)}
        </div>
    );
}
