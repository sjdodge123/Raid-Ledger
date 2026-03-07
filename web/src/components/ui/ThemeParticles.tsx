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

function setupCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
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

        const handleResize = () => {
            w = window.innerWidth; h = window.innerHeight;
            canvas.width = w; canvas.height = h;
            if (cfg.behavior === 'panel-edge') state.panelElements = queryPanelElements();
        };
        window.addEventListener('resize', handleResize);

        startAnimation(canvas, ctx, cfg, w, h, state, themeId, rafRef);

        return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', handleResize); ctx.clearRect(0, 0, w, h); };
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
            style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}
        />
    );
}
