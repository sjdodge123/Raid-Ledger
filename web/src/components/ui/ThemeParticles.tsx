/**
 * ThemeParticles — canvas-based ambient particles + background effects per theme.
 *
 * Background effects:
 *   aurora    — arctic: flowing aurora borealis bands at the top
 *   lava      — ember: pulsing lava glow at the bottom
 *   sun       — dawn: glowing sun in the upper-left
 *
 * Respects prefers-reduced-motion. Uses pointer-events: none.
 */
import { useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/theme-store';
import { CONFIGS } from './theme-particles.config';
import { spawnParticle, placePanelEdgeParticle, queryPanelElements } from './theme-particles.helpers';
import { tick, createTickState } from './theme-particles.tick';

/**
 * Effective drawable height: capped at the document's content height so
 * particles never render in empty space below the footer when content is
 * shorter than the viewport (ROK-1261). Falls back to viewport height when
 * the document is taller (long-content pages) so particles still cover the
 * visible viewport on first paint before scroll.
 */
function computeCanvasHeight() {
    const docH = document.documentElement.scrollHeight;
    const viewH = window.innerHeight;
    return docH > 0 ? Math.min(viewH, docH) : viewH;
}

function setupCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const w = window.innerWidth;
    const h = computeCanvasHeight();
    canvas.width = w;
    canvas.height = h;
    canvas.style.height = `${h}px`;
    return { ctx, w, h };
}

function startAnimation(
    _canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D,
    cfg: ReturnType<typeof Object>, w: number, h: number,
    state: ReturnType<typeof createTickState>,
    themeId: string, rafRef: React.MutableRefObject<number>,
) {
    const particles = initParticles(cfg, w, h, state);
    const loop = () => {
        try { tick(ctx, particles, cfg, w, h, state, themeId); }
        catch (e) { if (import.meta.env.DEV) console.warn('[ThemeParticles] tick error', e); }
        rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
}

function bindResizeListeners(handler: () => void) {
    window.addEventListener('resize', handler);
    // Document grows/shrinks on route changes, lazy images, dynamic content —
    // re-measure so the canvas keeps tracking the footer's bottom edge.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handler) : null;
    ro?.observe(document.documentElement);
    ro?.observe(document.body);
    return () => { window.removeEventListener('resize', handler); ro?.disconnect(); };
}

function useParticleAnimation(
    themeId: string,
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    rafRef: React.MutableRefObject<number>,
) {
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const cfg = CONFIGS[themeId];
        if (!cfg || !canvasRef.current) return;
        const setup = setupCanvas(canvasRef.current);
        if (!setup) return;
        const canvas = canvasRef.current;
        let { w, h } = setup;
        const { ctx } = setup;
        const state = createTickState();
        if (cfg.behavior === 'panel-edge') state.panelElements = queryPanelElements();
        const unbind = bindResizeListeners(() => {
            w = window.innerWidth; h = computeCanvasHeight();
            canvas.width = w; canvas.height = h;
            canvas.style.height = `${h}px`;
            if (cfg.behavior === 'panel-edge') state.panelElements = queryPanelElements();
        });
        startAnimation(canvas, ctx, cfg, w, h, state, themeId, rafRef);
        return () => { cancelAnimationFrame(rafRef.current); unbind(); ctx.clearRect(0, 0, w, h); };
    }, [themeId, canvasRef, rafRef]);
}

function initParticles(cfg: ReturnType<typeof Object>, w: number, h: number, state: ReturnType<typeof createTickState>) {
    return Array.from({ length: cfg.count }, () => {
        const p = spawnParticle(cfg, w, h);
        if (cfg.behavior === 'panel-edge') placePanelEdgeParticle(p, cfg, state.panelElements);
        return p;
    });
}

export function ThemeParticles() {
    const themeId = useThemeStore((s) => s.resolved.id);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);

    useParticleAnimation(themeId, canvasRef, rafRef);

    if (!CONFIGS[themeId]) return null;

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, pointerEvents: 'none', zIndex: 0 }}
        />
    );
}
