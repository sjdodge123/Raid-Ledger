/**
 * /dev/design-system — GuildMeter tones (§3.2) and the small vertical CSS
 * histogram (§4.30, ROK-1921). Static sample data, tokens only, so both flip
 * with the colour family. Lazy-loaded by DesignSystemPage.tsx (own Suspense).
 */
import type { JSX } from 'react';
import { GuildMeter, type MeterTone } from '../../components/hub/events/guild-meter';
import { FOCUS_RING } from '../../components/ui/form-classes';
import { Section, StateFrame } from './design-system-bits';

const TONES: { tone: MeterTone; pct: number; note: string }[] = [
    { tone: 'success', pct: 80, note: 'Default — a fill that is good (roster filled, requirement covered).' },
    { tone: 'warning', pct: 45, note: 'Short of a target (the Planner "short" bar).' },
    { tone: 'neutral', pct: 62, note: 'bg-secondary (ROK-1905) — a plain count that is neither good nor bad.' },
];

const BUCKETS = [
    { axis: '1–9', label: 'Levels 1–9', count: 2 },
    { axis: '10–19', label: 'Levels 10–19', count: 5 },
    { axis: '20–29', label: 'Levels 20–29', count: 9 },
    { axis: '30–39', label: 'Levels 30–39', count: 0 },
    { axis: '40–49', label: 'Levels 40–49', count: 1 },
    { axis: '50–60', label: 'Levels 50–60', count: 14 },
];

function Bar({ axis, label, count, max }: { axis: string; label: string; count: number; max: number }): JSX.Element {
    const height = max === 0 ? 0 : Math.max(count > 0 ? 4 : 0, Math.round((count / max) * 100));
    return (
        <a href="#meter-histogram" aria-label={`${label}: ${count} members`}
            className={`group flex min-w-0 flex-1 flex-col items-center gap-1 rounded-sm ${FOCUS_RING}`}>
            <span aria-hidden="true" className="text-xs font-semibold text-foreground">{count}</span>
            <span aria-hidden="true" className="flex h-24 w-full items-end rounded-sm bg-overlay">
                <span className="block w-full rounded-sm bg-secondary group-hover:opacity-80" style={{ height: `${height}%` }} />
            </span>
            <span aria-hidden="true" className="w-full truncate text-center text-[10px] text-muted">{axis}</span>
        </a>
    );
}

function MeterTones(): JSX.Element {
    return (
        <div data-testid="ds-guild-meter" className="grid gap-3 md:grid-cols-3">
            {TONES.map(({ tone, pct, note }) => (
                <StateFrame key={tone} label={`tone="${tone}" — ${pct}%`} note={note}>
                    <div className="w-full max-w-xs"><GuildMeter pct={pct} tone={tone} label={`${tone} meter ${pct}%`} /></div>
                </StateFrame>
            ))}
        </div>
    );
}

function Histogram(): JSX.Element {
    const max = BUCKETS.reduce((m, b) => Math.max(m, b.count), 0);
    return (
        <StateFrame label="Members per level range — 6 buckets" note="Fill is relative to the tallest bucket; a non-zero bucket is at least 4% tall. Neutral fill, never per-bar colour.">
            <div role="group" aria-label="Members per level range" data-testid="ds-css-histogram" className="flex w-full max-w-md items-end gap-1">
                {BUCKETS.map((b) => <Bar key={b.axis} {...b} max={max} />)}
            </div>
        </StateFrame>
    );
}

export function MeterHistogramSection(): JSX.Element {
    return (
        <Section
            id="meter-histogram"
            title="Pattern — meter tones and CSS histogram"
            blurb="§3.2 GuildMeter for one proportion (success / warning / neutral); §4.30 vertical CSS bars for ≤ ~10 buckets of one count. Both on tokens, no chart library."
        >
            <MeterTones />
            <h3 className="mt-6 text-sm font-semibold text-foreground">Small vertical histogram (§4.30, ROK-1921)</h3>
            <Histogram />
        </Section>
    );
}
