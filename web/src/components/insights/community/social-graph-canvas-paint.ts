/**
 * Canvas paint callbacks for `SocialGraphCanvas`. Each helper is a
 * module-scope factory parameterised by the current highlight state
 * (`activeId`, `activeNeighbors`) and, for the label pass, the graph's
 * node list — so the component only wires them into `ForceGraph2D`.
 */

// Screen-pixel sizes — constant regardless of zoom.
const BASE_RADIUS_PX = 4;
const DEGREE_RADIUS_STEP_PX = 1.1;
const MAX_DEGREE_FOR_SIZE = 8;
const HOVER_RADIUS_MULTIPLIER = 1.9;
const LABEL_FONT_PX_DEFAULT = 9;
const LABEL_FONT_PX_HOVER = 13;
const LABEL_HALO_LINE_WIDTH_PX = 3;

export interface GraphNode {
    id: number;
    label: string;
    color: string;
    degree: number;
    clique: number | null;
    x?: number;
    y?: number;
}

type LinkEnd = number | { id: number };

interface GraphLinkShape {
    source: LinkEnd;
    target: LinkEnd;
    value?: number;
}

/** The node the pointer/click currently highlights, plus its direct neighbours. */
export interface HighlightState {
    activeId: number | null;
    activeNeighbors: ReadonlySet<number>;
}

export function nodeScreenRadius(degree: number, highlighted: boolean): number {
    const clamped = Math.min(MAX_DEGREE_FOR_SIZE, Math.max(0, degree));
    const base = BASE_RADIUS_PX + Math.sqrt(clamped) * DEGREE_RADIUS_STEP_PX;
    return highlighted ? base * HOVER_RADIUS_MULTIPLIER : base;
}

function endId(end: LinkEnd): number {
    return typeof end === 'object' ? end.id : end;
}

function touchesActive(l: unknown, activeId: number | null): boolean {
    if (activeId == null) return false;
    const link = l as GraphLinkShape;
    return endId(link.source) === activeId || endId(link.target) === activeId;
}

export function makeLinkWidth(activeId: number | null) {
    return (l: unknown): number => {
        const base = Math.min(4, (l as GraphLinkShape).value ?? 1);
        return touchesActive(l, activeId) ? base + 1 : base;
    };
}

export function makeLinkColor(activeId: number | null) {
    return (l: unknown): string => {
        if (activeId == null) return 'rgba(168,85,247,0.35)';
        return touchesActive(l, activeId) ? 'rgba(168,85,247,0.85)' : 'rgba(168,85,247,0.06)';
    };
}

export function paintNodePointerArea(
    node: unknown,
    color: string,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
): void {
    const n = node as GraphNode;
    if (n.x == null || n.y == null) return;
    const radius = (nodeScreenRadius(n.degree, false) + 2) / globalScale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
    ctx.fill();
}

export function makeNodeCanvasObject({ activeId, activeNeighbors }: HighlightState) {
    return (node: unknown, ctx: CanvasRenderingContext2D, globalScale: number): void => {
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
    };
}

/**
 * Labels to draw this frame, in paint order: every positioned node when
 * nothing is highlighted, otherwise only the neighbours — with the active
 * node appended last so its label paints on top.
 */
export function labelDrawOrder(
    { activeId, activeNeighbors }: HighlightState,
    nodes: readonly GraphNode[],
): GraphNode[] {
    const focused = activeId != null;
    const order: GraphNode[] = [];
    for (const n of nodes) {
        if (n.x == null || n.y == null) continue;
        const isActive = n.id === activeId;
        const isNeighbor = focused && activeNeighbors.has(n.id);
        const show = focused ? isActive || isNeighbor : true;
        if (!show || isActive) continue;
        order.push(n);
    }
    const activeN = focused ? nodes.find((x) => x.id === activeId) : undefined;
    if (activeN) order.push(activeN);
    return order;
}

function drawLabel(
    ctx: CanvasRenderingContext2D,
    n: GraphNode,
    globalScale: number,
    { activeId, activeNeighbors }: HighlightState,
): void {
    if (n.x == null || n.y == null) return;
    const focused = activeId != null;
    const isActive = n.id === activeId;
    const isNeighbor = focused && activeNeighbors.has(n.id);
    const faded = focused && !isActive && !isNeighbor;
    const basePx = isActive ? LABEL_FONT_PX_HOVER : LABEL_FONT_PX_DEFAULT;
    ctx.font = `${basePx / globalScale}px Inter, ui-sans-serif, system-ui`;
    const radius = nodeScreenRadius(n.degree, isActive) / globalScale;
    const labelY = n.y + radius + 2 / globalScale;
    ctx.globalAlpha = faded ? 0.4 : 1;
    ctx.lineWidth = LABEL_HALO_LINE_WIDTH_PX / globalScale;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(n.label, n.x, labelY);
    ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255,255,255,0.95)';
    ctx.fillText(n.label, n.x, labelY);
}

export function makeRenderFramePost(state: HighlightState, graphData: { nodes: readonly GraphNode[] }) {
    return (ctx: CanvasRenderingContext2D, globalScale: number): void => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const n of labelDrawOrder(state, graphData.nodes)) drawLabel(ctx, n, globalScale, state);
        ctx.globalAlpha = 1;
    };
}
