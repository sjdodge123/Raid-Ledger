import { useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { CommunitySocialGraphResponseDto } from '@raid-ledger/contract';

interface Props {
    data: CommunitySocialGraphResponseDto;
}

const TIER_COLORS: Record<string, string> = {
    Hardcore: '#ef4444',
    Dedicated: '#fbbf24',
    Regular: '#22c55e',
    Casual: '#38bdf8',
};

/**
 * Lazy-loaded canvas render. Node color is driven by intensity tier,
 * node size by weighted degree, edge thickness by session count. The
 * canvas is marked `aria-hidden` — keyboard users consume the fallback
 * table via the "Show as table" toggle.
 */
export function SocialGraphCanvas({ data }: Props) {
    const graphData = useMemo(
        () => ({
            nodes: data.nodes.map((n) => ({
                id: n.userId,
                label: n.username,
                color: TIER_COLORS[n.intensityTier] ?? '#a855f7',
                val: Math.max(1, n.degree),
                clique: n.cliqueId,
            })),
            links: data.edges.map((e) => ({
                source: e.sourceUserId,
                target: e.targetUserId,
                value: e.weight,
            })),
        }),
        [data],
    );

    return (
        <div className="h-80 w-full rounded-lg border border-edge/30 overflow-hidden" aria-hidden="true">
            <ForceGraph2D
                graphData={graphData}
                backgroundColor="transparent"
                nodeLabel="label"
                nodeRelSize={4}
                linkWidth={(l: { value?: number }) => Math.min(4, (l.value ?? 1))}
                linkColor={() => 'rgba(168,85,247,0.35)'}
                enableNodeDrag={false}
            />
        </div>
    );
}
