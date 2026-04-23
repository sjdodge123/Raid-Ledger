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
 * Archetype distribution bar chart — one bar per (intensityTier,
 * vectorTitle) bucket, tinted by tier. Title-less buckets show the bare
 * tier label (e.g. "Hardcore Player").
 */
export function ArchetypeDistribution({ archetypes }: Props) {
    if (archetypes.length === 0) {
        return (
            <div className="h-60 flex items-center justify-center text-sm text-muted">
                No archetype distribution to show yet.
            </div>
        );
    }
    const data = archetypes.map((a) => ({
        label: a.vectorTitle ? `${a.intensityTier} ${a.vectorTitle}` : `${a.intensityTier} Player`,
        tier: a.intensityTier,
        count: a.count,
    }));
    return (
        <div className="h-60 w-full" data-testid="archetype-distribution">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#a1a1aa" fontSize={11} angle={-20} textAnchor="end" height={60} />
                    <YAxis stroke="#a1a1aa" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                    <Bar dataKey="count" isAnimationActive={false}>
                        {data.map((d, i) => (
                            <Cell key={i} fill={TIER_COLORS[d.tier] ?? '#a855f7'} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
