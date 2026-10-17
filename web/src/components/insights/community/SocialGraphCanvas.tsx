import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { CommunitySocialGraphResponseDto } from '@raid-ledger/contract';
import {
    makeLinkColor,
    makeLinkWidth,
    makeNodeCanvasObject,
    makeRenderFramePost,
    paintNodePointerArea,
    type GraphNode,
    type HighlightState,
} from './social-graph-canvas-paint';

interface Props {
    data: CommunitySocialGraphResponseDto;
}

type SocialNode = CommunitySocialGraphResponseDto['nodes'][number];
type SocialClique = CommunitySocialGraphResponseDto['cliques'][number];
type GraphRef = RefObject<ForceGraphMethods | undefined>;

interface GraphData {
    nodes: GraphNode[];
    links: { source: number; target: number; value: number }[];
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

function buildGraphData(data: CommunitySocialGraphResponseDto): GraphData {
    return {
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
    };
}

function buildNeighborMap(edges: CommunitySocialGraphResponseDto['edges']): Map<number, Set<number>> {
    const map = new Map<number, Set<number>>();
    for (const e of edges) {
        if (!map.has(e.sourceUserId)) map.set(e.sourceUserId, new Set());
        if (!map.has(e.targetUserId)) map.set(e.targetUserId, new Set());
        map.get(e.sourceUserId)!.add(e.targetUserId);
        map.get(e.targetUserId)!.add(e.sourceUserId);
    }
    return map;
}

function useGraphModel(data: CommunitySocialGraphResponseDto) {
    const graphData = useMemo(() => buildGraphData(data), [data]);
    const neighbors = useMemo(() => buildNeighborMap(data.edges), [data.edges]);
    const cliqueById = useMemo(
        () => new Map<number, SocialClique>(data.cliques.map((c) => [c.cliqueId, c])),
        [data.cliques],
    );
    const nodeById = useMemo(
        () => new Map<number, SocialNode>(data.nodes.map((n) => [n.userId, n])),
        [data.nodes],
    );
    return { graphData, neighbors, cliqueById, nodeById };
}

function useContainerWidth(containerRef: RefObject<HTMLDivElement | null>): number {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const el = containerRef.current;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, [containerRef]);
    return width;
}

/** Click-to-focus: fit the clicked node + its direct neighbours; reset refits everything. */
function useNodeFocus(graphRef: GraphRef, neighbors: Map<number, Set<number>>) {
    const [focusedId, setFocusedId] = useState<number | null>(null);
    const focusOnNode = (id: number) => {
        const fg = graphRef.current;
        if (!fg) return;
        setFocusedId(id);
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
    return { focusedId, focusOnNode, resetView };
}

interface GraphCanvasProps {
    graphRef: GraphRef;
    graphData: GraphData;
    width: number;
    highlight: HighlightState;
    onHover: (id: number | null) => void;
    onFocus: (id: number) => void;
}

function GraphCanvas({ graphRef, graphData, width, highlight, onHover, onFocus }: GraphCanvasProps) {
    return (
        <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            width={width}
            height={CANVAS_HEIGHT}
            backgroundColor="transparent"
            linkWidth={makeLinkWidth(highlight.activeId)}
            linkColor={makeLinkColor(highlight.activeId)}
            enableNodeDrag={false}
            enableZoomInteraction={false}
            enablePanInteraction={false}
            cooldownTicks={120}
            onEngineStop={() => graphRef.current?.zoomToFit(FIT_ANIM_MS, FIT_PADDING_PX)}
            onNodeHover={(n) => onHover((n as GraphNode | null)?.id ?? null)}
            onNodeClick={(n) => onFocus((n as GraphNode).id)}
            nodePointerAreaPaint={paintNodePointerArea}
            nodeCanvasObject={makeNodeCanvasObject(highlight)}
            onRenderFramePost={makeRenderFramePost(highlight, graphData)}
        />
    );
}

function openProfile(id: number) {
    window.open(`/users/${id}`, '_blank', 'noopener');
}

function FocusActions({ userId, onReset }: { userId: number; onReset: () => void }) {
    return (
        <div className="mt-2 flex gap-2">
            <button
                type="button"
                onClick={() => openProfile(userId)}
                className="flex-1 px-2 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
            >
                Open profile
            </button>
            <button
                type="button"
                onClick={onReset}
                className="px-2 py-1 text-xs font-medium bg-surface hover:bg-overlay border border-edge rounded text-secondary hover:text-foreground transition-colors"
            >
                Reset
            </button>
        </div>
    );
}

function FocusOverlay({ node, clique, onReset }: { node: SocialNode; clique: SocialClique | null; onReset: () => void }) {
    return (
        <div className="absolute top-3 right-3 min-w-[200px] max-w-[260px] bg-surface/95 backdrop-blur-sm border border-edge rounded-lg px-3 py-2 text-xs shadow-lg">
            <div className="font-semibold text-foreground">{node.username}</div>
            <div className="text-secondary">{node.intensityTier} · degree {node.degree}</div>
            {clique && (
                <div className="mt-1.5 pt-1.5 border-t border-edge/60 text-secondary">
                    <span className="text-muted">Clique #{clique.cliqueId}</span>
                    <span className="mx-1">·</span>
                    <span>{clique.memberUserIds.length} members</span>
                </div>
            )}
            <FocusActions userId={node.userId} onReset={onReset} />
        </div>
    );
}

function FocusHint() {
    return (
        <div className="absolute top-3 right-3 bg-surface/80 backdrop-blur-sm border border-edge rounded-lg px-3 py-1.5 text-[11px] text-muted pointer-events-none">
            Click a node to focus
        </div>
    );
}

interface CanvasOverlayProps {
    focusedId: number | null;
    nodeById: Map<number, SocialNode>;
    cliqueById: Map<number, SocialClique>;
    onReset: () => void;
}

/** The overlay sticks to the click-focused node (not hover) so its buttons stay usable. */
function CanvasOverlay({ focusedId, nodeById, cliqueById, onReset }: CanvasOverlayProps) {
    const node = focusedId != null ? nodeById.get(focusedId) ?? null : null;
    if (!node) return <FocusHint />;
    const clique = cliqueById.get(node.cliqueId) ?? null;
    return <FocusOverlay node={node} clique={clique} onReset={onReset} />;
}

/** Hover takes precedence over click-focus for the transient highlight. */
function highlightFor(
    hoveredId: number | null,
    focusedId: number | null,
    neighbors: Map<number, Set<number>>,
): HighlightState {
    const activeId = hoveredId ?? focusedId;
    const activeNeighbors = activeId != null ? neighbors.get(activeId) ?? new Set<number>() : new Set<number>();
    return { activeId, activeNeighbors };
}

function useForceLayout(graphRef: GraphRef, graphData: GraphData) {
    useEffect(() => {
        const fg = graphRef.current;
        if (!fg) return;
        fg.d3Force('charge')?.strength(CHARGE_STRENGTH);
        fg.d3Force('link')?.distance(LINK_DISTANCE);
        fg.zoomToFit(FIT_ANIM_MS, FIT_PADDING_PX);
    }, [graphRef, graphData]);
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
    const width = useContainerWidth(containerRef);
    const [hoveredId, setHoveredId] = useState<number | null>(null);
    const { graphData, neighbors, cliqueById, nodeById } = useGraphModel(data);
    const { focusedId, focusOnNode, resetView } = useNodeFocus(graphRef, neighbors);
    useForceLayout(graphRef, graphData);

    return (
        <div ref={containerRef} style={{ height: CANVAS_HEIGHT }}
            className="relative w-full rounded-lg border border-edge/30 overflow-hidden bg-overlay/10">
            <div aria-hidden="true">
                {width > 0 && (
                    <GraphCanvas
                        graphRef={graphRef}
                        graphData={graphData}
                        width={width}
                        highlight={highlightFor(hoveredId, focusedId, neighbors)}
                        onHover={setHoveredId}
                        onFocus={focusOnNode}
                    />
                )}
            </div>
            <CanvasOverlay focusedId={focusedId} nodeById={nodeById} cliqueById={cliqueById} onReset={resetView} />
        </div>
    );
}
