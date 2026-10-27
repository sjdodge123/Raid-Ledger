/**
 * ROK-1921 (spec ROK-1905 W2) — WoW: Forever "Level progression" hub widget: a
 * histogram of the level buckets (CSS bars on theme tokens — the design system
 * has no chart primitive and recharts would bloat this card), median / max /
 * "N at cap", and the five highest names. A bucket jumps to the Members tab
 * (it has no level filter yet); a linked name opens its character sheet.
 */
import { useState, type JSX } from 'react';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { CharacterLink } from '../../../components/hub/character-link';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { bucketAxis, bucketLabel, memberCount, topLeveled } from './class-level.helpers';
import { useRosterInsights } from './use-roster-insights';
import { RosterWidgetShell } from './widget-shell';

type Levels = WowRosterInsightsDto['levels'];
type Bucket = Levels['buckets'][number];

function BucketBar({ b, max }: { b: Bucket; max: number }): JSX.Element {
    const height = max === 0 ? 0 : Math.max(b.count > 0 ? 4 : 0, Math.round((b.count / max) * 100));
    return (
        <a href="#members" data-testid={`forever-level-bucket-${b.from}-${b.to}`}
            aria-label={`${bucketLabel(b.from, b.to)}: ${memberCount(b.count)}`}
            className={`group flex min-w-0 flex-1 flex-col items-center gap-1 rounded-sm ${FOCUS_RING}`}>
            <span aria-hidden="true" className="text-xs font-semibold text-foreground">{b.count}</span>
            <span aria-hidden="true" className="flex h-24 w-full items-end rounded-sm bg-overlay">
                <span className="block w-full rounded-sm bg-secondary group-hover:opacity-80" style={{ height: `${height}%` }} />
            </span>
            <span aria-hidden="true" className="w-full truncate text-center text-[10px] text-muted">{bucketAxis(b.from, b.to)}</span>
        </a>
    );
}

function Histogram({ buckets }: { buckets: Levels['buckets'] }): JSX.Element {
    const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
    return (
        <div role="group" aria-label="Members per level range" className="flex items-end gap-1">
            {buckets.map((b) => <BucketBar key={`${b.from}-${b.to}`} b={b} max={max} />)}
        </div>
    );
}

function Stat({ testId, label, value }: { testId: string; label: string; value: number | null }): JSX.Element {
    return (
        <div className="flex flex-col">
            <dt className="text-xs text-muted">{label}</dt>
            <dd data-testid={testId} className="text-lg font-semibold text-foreground">{value === null ? '—' : Math.round(value)}</dd>
        </div>
    );
}

function TopFive({ insights }: { insights: WowRosterInsightsDto }): JSX.Element | null {
    const top = topLeveled(insights);
    if (top.length === 0) return null;
    return (
        <div>
            <h4 className="mb-1 text-xs font-medium text-muted">Highest levels</h4>
            <ol data-testid="forever-level-top" className="flex flex-col gap-1 text-sm">
                {top.map((m) => (
                    <li key={`${m.characterId ?? 'u'}-${m.name}`} className="flex items-center justify-between gap-2">
                        <CharacterLink name={m.name} characterId={m.characterId} /><span className="text-secondary">{m.level}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

function LevelBody({ insights }: { insights: WowRosterInsightsDto }): JSX.Element {
    const { levels } = insights;
    return (
        <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
                <Histogram buckets={levels.buckets} />
                <dl className="grid grid-cols-3 gap-2">
                    <Stat testId="forever-level-median" label="Median" value={levels.median} />
                    <Stat testId="forever-level-max" label="Highest" value={levels.max} />
                    <Stat testId="forever-level-at-cap" label="At cap" value={levels.atCap} />
                </dl>
            </div>
            <div className="md:w-48"><TopFive insights={insights} /></div>
        </div>
    );
}

/** W2 body — registered lazily by `class-level.register.ts`. */
export default function LevelProgressionWidget({ page }: HubWidgetCtx): JSX.Element {
    const [mainsOnly, setMainsOnly] = useState(false);
    const query = useRosterInsights(page.guild.id, mainsOnly);
    return (
        <RosterWidgetShell query={query} mainsOnly={mainsOnly} onMainsOnly={setMainsOnly}>
            {(insights) => <LevelBody insights={insights} />}
        </RosterWidgetShell>
    );
}
