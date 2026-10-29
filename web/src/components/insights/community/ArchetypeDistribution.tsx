import { useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { chartAxisProps, chartBarTooltipProps, chartGridProps } from '../../ui/chart-chrome';
import type { CommunityRadarResponseDto } from '@raid-ledger/contract';

interface Props {
    archetypes: CommunityRadarResponseDto['archetypes'];
}

const TIER_COLORS: Record<string, string> = {
    Hardcore: '#ef4444',
    Dedicated: '#fbbf24',
    Regular: '#22c55e',
    Casual: '#38bdf8',
    /** ROK-1935: no play sessions seen yet — the quiet neutral token, so it repaints per scheme. */
    Newcomer: 'var(--color-dim)',
};

const DEFAULT_VISIBLE = 10;

/**
 * Archetype distribution — horizontal bars so the composed
 * `{intensityTier} {vectorTitle}` labels get room on the left without
 * overlapping. Sorted descending by count. Top 10 shown by default with
 * a "Show more" toggle for larger communities with long archetype tails.
 */
export function ArchetypeDistribution({ archetypes }: Props) {
    const [expanded, setExpanded] = useState(false);
    if (archetypes.length === 0) {
        return (
            <div className="h-60 flex items-center justify-center text-sm text-muted">
                No archetype distribution to show yet.
            </div>
        );
    }
    const sorted = toRows(archetypes);
    const hidden = sorted.length - DEFAULT_VISIBLE;
    const data = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
    return (
        <div className="w-full" data-testid="archetype-distribution">
            <ArchetypeBars data={data} />
            {hidden > 0 && (
                <div className="mt-2 flex justify-center">
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        aria-expanded={expanded}
                        className="px-3 py-1.5 text-xs font-medium bg-surface/50 hover:bg-surface border border-edge rounded-md text-secondary hover:text-foreground transition-colors"
                    >
                        {expanded ? `Show top ${DEFAULT_VISIBLE}` : `Show ${hidden} more`}
                    </button>
                </div>
            )}
        </div>
    );
}

interface ArchetypeRow {
    label: string;
    tier: string;
    count: number;
}

const ROW_HEIGHT = 28;

/** Composes each bar's `{tier} {title}` label and sorts by count, descending. */
function toRows(archetypes: Props['archetypes']): ArchetypeRow[] {
    return [...archetypes]
        .map((a) => ({
            label: a.vectorTitle ? `${a.intensityTier} ${a.vectorTitle}` : `${a.intensityTier} Player`,
            tier: a.intensityTier,
            count: a.count,
        }))
        .sort((a, b) => b.count - a.count);
}

/** The horizontal bar chart itself, on the shared token chrome (ROK-1937). */
function ArchetypeBars({ data }: { data: ArchetypeRow[] }) {
    const chartHeight = Math.max(240, data.length * ROW_HEIGHT + 40);
    return (
        <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                    <CartesianGrid {...chartGridProps} horizontal={false} />
                    <XAxis type="number" {...chartAxisProps} fontSize={11} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" {...chartAxisProps} fontSize={11} width={170} interval={0} />
                    <Tooltip {...chartBarTooltipProps} />
                    <Bar dataKey="count" isAnimationActive={false} barSize={18}>
                        {data.map((d, i) => (
                            <Cell key={i} fill={TIER_COLORS[d.tier] ?? '#a855f7'} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
