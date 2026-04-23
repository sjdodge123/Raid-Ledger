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

const CANVAS_HEIGHT = 520;
const CHARGE_STRENGTH = -320;
const LINK_DISTANCE = 70;

// Screen-pixel sizes — constant regardless of zoom.
const BASE_RADIUS_PX = 4;
const DEGREE_RADIUS_STEP_PX = 1.1;
const MAX_DEGREE_FOR_SIZE = 8;
const HOVER_RADIUS_MULTIPLIER = 1.9;
const LABEL_FONT_PX = 11;
const LABEL_MIN_FONT_PX = 9;
const MIN_ZOOM_FOR_DEFAULT_LABELS = 1.4;

interface GraphNode {
    id: number;
    label: string;
    color: string;
    degree: number;
    clique: number | null;
    x?: number;
    y?: number;
}

function nodeScreenRadius(degree: number, hovered: boolean): number {
    const clamped = Math.min(MAX_DEGREE_FOR_SIZE, Math.max(0, degree));
    const base = BASE_RADIUS_PX + Math.sqrt(clamped) * DEGREE_RADIUS_STEP_PX;
    return hovered ? base * HOVER_RADIUS_MULTIPLIER : base;
}

/**
 * Lazy-loaded canvas render. Node color is driven by intensity tier,
 * node size by weighted degree. All rendering is in screen pixels —
 * nodes and labels stay the same apparent size as the viewer zooms.
 * Hovering a node fades other labels, ringed + enlarges the hovered
 * node, and surfaces its clique in the overlay. Clicking opens the
 * player's profile in a new tab. Canvas is `aria-hidden` — keyboard
 * users consume the fallback table via the "Show as table" toggle.
 */
export function SocialGraphCanvas({ data }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
    const [width, setWidth] = useState(0);
    const [hoveredId, setHoveredId] = useState<number | null>(null);

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
                degree: Math.max(1, n.degree),
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

    const neighbors = useMemo(() => {
        const map = new Map<number, Set<number>>();
        for (const e of data.edges) {
            if (!map.has(e.sourceUserId)) map.set(e.sourceUserId, new Set());
            if (!map.has(e.targetUserId)) map.set(e.targetUserId, new Set());
            map.get(e.sourceUserId)!.add(e.targetUserId);
            map.get(e.targetUserId)!.add(e.sourceUserId);
        }
        return map;
    }, [data.edges]);

    const cliqueById = useMemo(() => {
        const m = new Map<number, { cliqueId: number; memberUserIds: number[] }>();
        for (const c of data.cliques) m.set(c.cliqueId, c);
        return m;
    }, [data.cliques]);

    const nodeById = useMemo(() => {
        const m = new Map<number, (typeof data.nodes)[number]>();
        for (const n of data.nodes) m.set(n.userId, n);
        return m;
    }, [data.nodes]);

    const hoveredNode = hoveredId != null ? nodeById.get(hoveredId) ?? null : null;
    const hoveredClique = hoveredNode ? cliqueById.get(hoveredNode.cliqueId) ?? null : null;
    const hoveredNeighbors = hoveredId != null ? neighbors.get(hoveredId) ?? new Set<number>() : new Set<number>();

    useEffect(() => {
        const fg = graphRef.current;
        if (!fg) return;
        fg.d3Force('charge')?.strength(CHARGE_STRENGTH);
        fg.d3Force('link')?.distance(LINK_DISTANCE);
        fg.zoomToFit(400, 80);
    }, [graphData]);

    return (
        <div
            ref={containerRef}
            className="relative w-full rounded-lg border border-edge/30 overflow-hidden bg-overlay/10"
            style={{ height: CANVAS_HEIGHT }}
        >
            <div aria-hidden="true">
                {width > 0 && (
                    <ForceGraph2D
                        ref={graphRef}
                        graphData={graphData}
                        width={width}
                        height={CANVAS_HEIGHT}
                        backgroundColor="transparent"
                        nodeLabel="label"
                        linkWidth={(l: { value?: number }) => Math.min(4, (l.value ?? 1))}
                        linkColor={() => 'rgba(168,85,247,0.35)'}
                        enableNodeDrag={false}
                        cooldownTicks={120}
                        onEngineStop={() => graphRef.current?.zoomToFit(400, 80)}
                        onNodeHover={(n) => setHoveredId((n as GraphNode | null)?.id ?? null)}
                        onNodeClick={(n) => {
                            const id = (n as GraphNode).id;
                            window.open(`/users/${id}`, '_blank', 'noopener');
                        }}
                        nodePointerAreaPaint={(node, color, ctx, globalScale) => {
                            const n = node as GraphNode;
                            if (n.x == null || n.y == null) return;
                            const radius = (nodeScreenRadius(n.degree, false) + 2) / globalScale;
                            ctx.fillStyle = color;
                            ctx.beginPath();
                            ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
                            ctx.fill();
                        }}
                        nodeCanvasObject={(node, ctx, globalScale) => {
                            const n = node as GraphNode;
                            if (n.x == null || n.y == null) return;
                            const hovered = n.id === hoveredId;
                            const radius = nodeScreenRadius(n.degree, hovered) / globalScale;
                            const isFocusedSet = hoveredId != null;
                            const isNeighbor = isFocusedSet && hoveredNeighbors.has(n.id);
                            const faded = isFocusedSet && !hovered && !isNeighbor;
                            ctx.globalAlpha = faded ? 0.25 : 1;
                            ctx.beginPath();
                            ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
                            ctx.fillStyle = n.color;
                            ctx.fill();
                            if (hovered) {
                                ctx.lineWidth = 1.5 / globalScale;
                                ctx.strokeStyle = 'rgba(255,255,255,0.95)';
                                ctx.stroke();
                            }
                            const showLabel = isFocusedSet
                                ? hovered || isNeighbor
                                : globalScale >= MIN_ZOOM_FOR_DEFAULT_LABELS;
                            if (showLabel) {
                                const fontPx = hovered ? LABEL_FONT_PX + 2 : LABEL_FONT_PX;
                                const fontWorld = Math.max(LABEL_MIN_FONT_PX, fontPx) / globalScale;
                                ctx.font = `${fontWorld}px Inter, ui-sans-serif, system-ui`;
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'top';
                                ctx.fillStyle = hovered ? '#ffffff' : 'rgba(255,255,255,0.9)';
                                ctx.fillText(n.label, n.x, n.y + radius + 2 / globalScale);
                            }
                            ctx.globalAlpha = 1;
                        }}
                    />
                )}
            </div>
            {hoveredNode && (
                <div className="absolute top-3 right-3 min-w-[180px] max-w-[240px] bg-surface/95 backdrop-blur-sm border border-edge rounded-lg px-3 py-2 text-xs pointer-events-none shadow-lg">
                    <div className="font-semibold text-foreground">{hoveredNode.username}</div>
                    <div className="text-secondary">{hoveredNode.intensityTier} · degree {hoveredNode.degree}</div>
                    {hoveredClique && (
                        <div className="mt-1.5 pt-1.5 border-t border-edge/60 text-secondary">
                            <span className="text-muted">Clique #{hoveredClique.cliqueId}</span>
                            <span className="mx-1">·</span>
                            <span>{hoveredClique.memberUserIds.length} members</span>
                        </div>
                    )}
                    <div className="mt-1 text-muted text-[10px]">Click to open profile</div>
                </div>
            )}
        </div>
    );
}
