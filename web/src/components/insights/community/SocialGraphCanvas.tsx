import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
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

const CANVAS_HEIGHT = 420;

/**
 * Lazy-loaded canvas render. Node color is driven by intensity tier,
 * node size by weighted degree, edge thickness by session count. Names
 * render as labels beneath each node on the canvas itself. Auto-fits
 * the view when the simulation settles. The canvas is marked
 * `aria-hidden` — keyboard users consume the fallback table via the
 * "Show as table" toggle.
 */
export function SocialGraphCanvas({ data }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
    const [width, setWidth] = useState(0);

    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const el = containerRef.current;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

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

    useEffect(() => {
        if (graphRef.current) graphRef.current.zoomToFit(400, 40);
    }, [graphData]);

    return (
        <div
            ref={containerRef}
            className="w-full rounded-lg border border-edge/30 overflow-hidden bg-overlay/10"
            style={{ height: CANVAS_HEIGHT }}
            aria-hidden="true"
        >
            {width > 0 && (
                <ForceGraph2D
                    ref={graphRef}
                    graphData={graphData}
                    width={width}
                    height={CANVAS_HEIGHT}
                    backgroundColor="transparent"
                    nodeRelSize={4}
                    linkWidth={(l: { value?: number }) => Math.min(4, (l.value ?? 1))}
                    linkColor={() => 'rgba(168,85,247,0.35)'}
                    enableNodeDrag={false}
                    cooldownTicks={100}
                    onEngineStop={() => graphRef.current?.zoomToFit(400, 40)}
                    nodeCanvasObjectMode={() => 'after'}
                    nodeCanvasObject={(node: { x?: number; y?: number; label?: string; val?: number }, ctx, globalScale) => {
                        if (!node.label || node.x == null || node.y == null) return;
                        const fontSize = Math.max(9, 12 / Math.sqrt(globalScale));
                        ctx.font = `${fontSize}px Inter, ui-sans-serif, system-ui`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillStyle = 'rgba(255,255,255,0.85)';
                        const offset = Math.sqrt(node.val ?? 1) * 4 + 4;
                        ctx.fillText(node.label, node.x, node.y + offset);
                    }}
                />
            )}
        </div>
    );
}
