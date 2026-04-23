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

/**
 * Archetype distribution — horizontal bars so the composed
 * `{intensityTier} {vectorTitle}` labels get room on the left without
 * overlapping. Sorted descending by count; height scales with bucket
 * count to keep bars readable.
 */
export function ArchetypeDistribution({ archetypes }: Props) {
    if (archetypes.length === 0) {
        return (
            <div className="h-60 flex items-center justify-center text-sm text-muted">
                No archetype distribution to show yet.
            </div>
        );
    }
    const data = [...archetypes]
        .map((a) => ({
            label: a.vectorTitle ? `${a.intensityTier} ${a.vectorTitle}` : `${a.intensityTier} Player`,
            tier: a.intensityTier,
            count: a.count,
        }))
        .sort((a, b) => b.count - a.count);
    const rowHeight = 26;
    const chartHeight = Math.max(240, data.length * rowHeight + 40);
    return (
        <div className="w-full" style={{ height: chartHeight }} data-testid="archetype-distribution">
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
    );
}
