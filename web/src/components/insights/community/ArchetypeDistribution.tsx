import { useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { CommunityRadarResponseDto } from '@raid-ledger/contract';

interface Props {
    archetypes: CommunityRadarResponseDto['archetypes'];
}

const TIER_COLORS: Record<string, string> = {
    Hardcore: '#ef4444',
    Dedicated: '#fbbf24',
    Regular: '#22c55e',
    Casual: '#38bdf8',
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
    const sorted = [...archetypes]
        .map((a) => ({
            label: a.vectorTitle ? `${a.intensityTier} ${a.vectorTitle}` : `${a.intensityTier} Player`,
            tier: a.intensityTier,
            count: a.count,
        }))
        .sort((a, b) => b.count - a.count);
    const hidden = sorted.length - DEFAULT_VISIBLE;
    const data = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
    const rowHeight = 28;
    const chartHeight = Math.max(240, data.length * rowHeight + 40);
    return (
        <div className="w-full" data-testid="archetype-distribution">
            <div style={{ height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" stroke="#a1a1aa" fontSize={11} allowDecimals={false} />
                        <YAxis type="category" dataKey="label" stroke="#a1a1aa" fontSize={11} width={170} interval={0} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                        <Bar dataKey="count" isAnimationActive={false} barSize={18}>
                            {data.map((d, i) => (
                                <Cell key={i} fill={TIER_COLORS[d.tier] ?? '#a855f7'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
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
