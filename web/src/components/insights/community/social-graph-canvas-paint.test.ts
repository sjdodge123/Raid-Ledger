/**
 * Pins the paint helpers hoisted out of SocialGraphCanvas: link emphasis,
 * which labels draw (and in what order), and node fading when a node is
 * highlighted. Canvas calls are recorded on a minimal fake context.
 */
import { describe, it, expect } from 'vitest';
import {
    labelDrawOrder,
    makeLinkColor,
    makeLinkWidth,
    makeNodeCanvasObject,
    makeRenderFramePost,
    type GraphNode,
} from './social-graph-canvas-paint';

const node = (id: number, x = 10, y = 10): GraphNode => ({ id, label: `n${id}`, color: '#000', degree: 2, clique: 1, x, y });

function fakeCtx() {
    const calls: { op: string; arg?: unknown; alpha?: number }[] = [];
    const ctx = {
        globalAlpha: 1,
        beginPath: () => calls.push({ op: 'beginPath' }),
        arc: () => calls.push({ op: 'arc' }),
        fill: () => calls.push({ op: 'fill', alpha: ctx.globalAlpha }),
        stroke: () => calls.push({ op: 'stroke' }),
        strokeText: (t: string) => calls.push({ op: 'strokeText', arg: t }),
        fillText: (t: string) => calls.push({ op: 'fillText', arg: t }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('social-graph-canvas-paint', () => {
    it('thickens and brightens only links touching the active node', () => {
        const touching = { source: { id: 1 }, target: 2, value: 3 };
        const other = { source: 3, target: 4, value: 9 };
        expect(makeLinkWidth(1)(touching)).toBe(4);
        expect(makeLinkWidth(1)(other)).toBe(4);
        expect(makeLinkWidth(null)(touching)).toBe(3);
        expect(makeLinkColor(null)(other)).toBe('rgba(168,85,247,0.35)');
        expect(makeLinkColor(1)(touching)).toBe('rgba(168,85,247,0.85)');
        expect(makeLinkColor(1)(other)).toBe('rgba(168,85,247,0.06)');
    });

    it('labels every positioned node when nothing is active', () => {
        const nodes = [node(1), node(2), { ...node(3), x: undefined }];
        const order = labelDrawOrder({ activeId: null, activeNeighbors: new Set() }, nodes);
        expect(order.map((n) => n.id)).toEqual([1, 2]);
    });

    it('labels only neighbours when focused, drawing the active node last', () => {
        const nodes = [node(1), node(2), node(3), node(4)];
        const state = { activeId: 2, activeNeighbors: new Set([1, 4]) };
        expect(labelDrawOrder(state, nodes).map((n) => n.id)).toEqual([1, 4, 2]);
        const { ctx, calls } = fakeCtx();
        makeRenderFramePost(state, { nodes })(ctx, 1);
        expect(calls.filter((c) => c.op === 'fillText').map((c) => c.arg)).toEqual(['n1', 'n4', 'n2']);
    });

    it('fades non-neighbours and outlines the active node', () => {
        const paint = makeNodeCanvasObject({ activeId: 2, activeNeighbors: new Set([1]) });
        const faded = fakeCtx();
        paint(node(3), faded.ctx, 1);
        expect(faded.calls.find((c) => c.op === 'fill')?.alpha).toBe(0.25);
        expect(faded.calls.some((c) => c.op === 'stroke')).toBe(false);
        const active = fakeCtx();
        paint(node(2), active.ctx, 1);
        expect(active.calls.find((c) => c.op === 'fill')?.alpha).toBe(1);
        expect(active.calls.some((c) => c.op === 'stroke')).toBe(true);
    });
});
