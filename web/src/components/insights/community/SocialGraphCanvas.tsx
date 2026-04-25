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
const CHARGE_STRENGTH = -1100;
const LINK_DISTANCE = 170;
const FOCUS_ANIM_MS = 700;
const FOCUS_PADDING_PX = 80;
const FIT_ANIM_MS = 400;
const FIT_PADDING_PX = 80;

// Screen-pixel sizes — constant regardless of zoom.
const BASE_RADIUS_PX = 4;
const DEGREE_RADIUS_STEP_PX = 1.1;
const MAX_DEGREE_FOR_SIZE = 8;
const HOVER_RADIUS_MULTIPLIER = 1.9;
const LABEL_FONT_PX_DEFAULT = 9;
const LABEL_FONT_PX_HOVER = 13;
const LABEL_HALO_LINE_WIDTH_PX = 3;

interface GraphNode {
    id: number;
    label: string;
    color: string;
    degree: number;
    clique: number | null;
    x?: number;
    y?: number;
}

function nodeScreenRadius(degree: number, highlighted: boolean): number {
    const clamped = Math.min(MAX_DEGREE_FOR_SIZE, Math.max(0, degree));
    const base = BASE_RADIUS_PX + Math.sqrt(clamped) * DEGREE_RADIUS_STEP_PX;
    return highlighted ? base * HOVER_RADIUS_MULTIPLIER : base;
}

/**
 * Lazy-loaded canvas render. Free pan/zoom is disabled — clicking a
 * node smooth-pans + zooms to it and highlights its neighbors. The
 * overlay carries "Open profile" + "Reset view" buttons. Hover still
 * works for transient highlight. Canvas is `aria-hidden` — keyboard
 * users consume the fallback table via the "Show as table" toggle.
 */
export function SocialGraphCanvas({ data }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
    const [width, setWidth] = useState(0);
    const [hoveredId, setHoveredId] = useState<number | null>(null);
    const [focusedId, setFocusedId] = useState<number | null>(null);

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

    // Hover takes precedence over click-focus for transient highlight,
    // but the overlay sticks to focused so the buttons remain usable.
    const activeId = hoveredId ?? focusedId;
    const focusedNode = focusedId != null ? nodeById.get(focusedId) ?? null : null;
    const focusedClique = focusedNode ? cliqueById.get(focusedNode.cliqueId) ?? null : null;
    const activeNeighbors = activeId != null ? neighbors.get(activeId) ?? new Set<number>() : new Set<number>();

    useEffect(() => {
        const fg = graphRef.current;
        if (!fg) return;
        fg.d3Force('charge')?.strength(CHARGE_STRENGTH);
        fg.d3Force('link')?.distance(LINK_DISTANCE);
        fg.zoomToFit(FIT_ANIM_MS, FIT_PADDING_PX);
    }, [graphData]);

    const focusOnNode = (id: number) => {
        const fg = graphRef.current;
        if (!fg) return;
        setFocusedId(id);
        // Fit the clicked node + all its direct neighbors in view.
        const ns = neighbors.get(id) ?? new Set<number>();
        fg.zoomToFit(FOCUS_ANIM_MS, FOCUS_PADDING_PX, (n) => {
            const nid = (n as GraphNode).id;
            return nid === id || ns.has(nid);
        });
    };

    const resetView = () => {
        const fg = graphRef.current;
        if (!fg) return;
        setFocusedId(null);
        fg.zoomToFit(FIT_ANIM_MS, FIT_PADDING_PX);
    };

    const openProfile = (id: number) => {
        window.open(`/users/${id}`, '_blank', 'noopener');
    };

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
                        linkWidth={(l: unknown) => {
                            const link = l as { source: number | { id: number }; target: number | { id: number }; value?: number };
                            const s = typeof link.source === 'object' ? link.source.id : link.source;
                            const t = typeof link.target === 'object' ? link.target.id : link.target;
                            const involved = activeId != null && (s === activeId || t === activeId);
                            const base = Math.min(4, link.value ?? 1);
                            return involved ? base + 1 : base;
                        }}
                        linkColor={(l: unknown) => {
                            if (activeId == null) return 'rgba(168,85,247,0.35)';
                            const link = l as { source: number | { id: number }; target: number | { id: number } };
                            const s = typeof link.source === 'object' ? link.source.id : link.source;
                            const t = typeof link.target === 'object' ? link.target.id : link.target;
                            return s === activeId || t === activeId
                                ? 'rgba(168,85,247,0.85)'
                                : 'rgba(168,85,247,0.06)';
                        }}
                        enableNodeDrag={false}
                        enableZoomInteraction={false}
                        enablePanInteraction={false}
                        cooldownTicks={120}
                        onEngineStop={() => graphRef.current?.zoomToFit(FIT_ANIM_MS, FIT_PADDING_PX)}
                        onNodeHover={(n) => setHoveredId((n as GraphNode | null)?.id ?? null)}
                        onNodeClick={(n) => focusOnNode((n as GraphNode).id)}
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
                            const isActive = n.id === activeId;
                            const radius = nodeScreenRadius(n.degree, isActive) / globalScale;
                            const isFocusedSet = activeId != null;
                            const isNeighbor = isFocusedSet && activeNeighbors.has(n.id);
                            const faded = isFocusedSet && !isActive && !isNeighbor;
                            ctx.globalAlpha = faded ? 0.25 : 1;
                            ctx.beginPath();
                            ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
                            ctx.fillStyle = n.color;
                            ctx.fill();
                            if (isActive) {
                                ctx.lineWidth = 1.5 / globalScale;
                                ctx.strokeStyle = 'rgba(255,255,255,0.95)';
                                ctx.stroke();
                            }
                            ctx.globalAlpha = 1;
                        }}
                        onRenderFramePost={(ctx, globalScale) => {
                            const focused = activeId != null;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'top';
                            const drawOrder: GraphNode[] = [];
                            for (const node of graphData.nodes) {
                                const n = node as GraphNode;
                                if (n.x == null || n.y == null) continue;
                                const isActive = n.id === activeId;
                                const isNeighbor = focused && activeNeighbors.has(n.id);
                                const show = focused ? isActive || isNeighbor : true;
                                if (!show) continue;
                                if (isActive) continue;
                                drawOrder.push(n);
                            }
                            const activeN = focused
                                ? (graphData.nodes.find((x) => (x as GraphNode).id === activeId) as GraphNode | undefined)
                                : undefined;
                            if (activeN) drawOrder.push(activeN);
                            for (const n of drawOrder) {
                                if (n.x == null || n.y == null) continue;
                                const isActive = n.id === activeId;
                                const isNeighbor = focused && activeNeighbors.has(n.id);
                                const faded = focused && !isActive && !isNeighbor;
                                const basePx = isActive ? LABEL_FONT_PX_HOVER : LABEL_FONT_PX_DEFAULT;
                                const fontWorld = basePx / globalScale;
                                ctx.font = `${fontWorld}px Inter, ui-sans-serif, system-ui`;
                                const radius = nodeScreenRadius(n.degree, isActive) / globalScale;
                                const labelY = n.y + radius + 2 / globalScale;
                                ctx.globalAlpha = faded ? 0.4 : 1;
                                ctx.lineWidth = LABEL_HALO_LINE_WIDTH_PX / globalScale;
                                ctx.strokeStyle = 'rgba(0,0,0,0.9)';
                                ctx.strokeText(n.label, n.x, labelY);
                                ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255,255,255,0.95)';
                                ctx.fillText(n.label, n.x, labelY);
                            }
                            ctx.globalAlpha = 1;
                        }}
                    />
                )}
            </div>
            {focusedNode && (
                <div className="absolute top-3 right-3 min-w-[200px] max-w-[260px] bg-surface/95 backdrop-blur-sm border border-edge rounded-lg px-3 py-2 text-xs shadow-lg">
                    <div className="font-semibold text-foreground">{focusedNode.username}</div>
                    <div className="text-secondary">{focusedNode.intensityTier} · degree {focusedNode.degree}</div>
                    {focusedClique && (
                        <div className="mt-1.5 pt-1.5 border-t border-edge/60 text-secondary">
                            <span className="text-muted">Clique #{focusedClique.cliqueId}</span>
                            <span className="mx-1">·</span>
                            <span>{focusedClique.memberUserIds.length} members</span>
                        </div>
                    )}
                    <div className="mt-2 flex gap-2">
                        <button
                            type="button"
                            onClick={() => openProfile(focusedNode.userId)}
                            className="flex-1 px-2 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
                        >
                            Open profile
                        </button>
                        <button
                            type="button"
                            onClick={resetView}
                            className="px-2 py-1 text-xs font-medium bg-surface hover:bg-overlay border border-edge rounded text-secondary hover:text-foreground transition-colors"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            )}
            {!focusedNode && (
                <div className="absolute top-3 right-3 bg-surface/80 backdrop-blur-sm border border-edge rounded-lg px-3 py-1.5 text-[11px] text-muted pointer-events-none">
                    Click a node to focus
                </div>
            )}
        </div>
    );
}
