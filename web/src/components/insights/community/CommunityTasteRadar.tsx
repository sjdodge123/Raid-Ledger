import type { CommunityRadarResponseDto } from '@raid-ledger/contract';
import {
    Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts';
import type { TasteProfilePoolAxis } from '@raid-ledger/contract';
import { axisLabel } from '../../taste-profile/taste-profile-helpers';

interface Props {
    axes: CommunityRadarResponseDto['axes'];
}

/**
 * Aggregate community-wide taste radar — mean axis scores rendered on the
 * same radial chart shape used by per-player taste profiles (ROK-949).
 * Reuses the `axisLabel` helper so labels stay in sync.
 */
export function CommunityTasteRadar({ axes }: Props) {
    const data = axes
        .slice()
        .sort((a, b) => b.meanScore - a.meanScore)
        .slice(0, 7)
        .map((a) => ({
            axis: axisLabel(a.axis as TasteProfilePoolAxis),
            value: Math.round(a.meanScore),
        }));
    if (data.length === 0) {
        return <EmptyRadar />;
    }
    return (
        <div className="h-72 w-full" role="img" aria-label="Community taste radar">
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={data} outerRadius="75%">
                    <PolarGrid stroke="rgba(255,255,255,0.15)" />
                    <PolarAngleAxis dataKey="axis" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar dataKey="value" stroke="#a855f7" strokeWidth={2}
                        fill="#a855f7" fillOpacity={0.35} isAnimationActive={false} />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    );
}

function EmptyRadar() {
    return (
        <div className="h-72 flex items-center justify-center text-sm text-muted">
            Not enough play history yet to compute a community radar.
        </div>
    );
}
