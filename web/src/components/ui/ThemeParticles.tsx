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

export function ThemeParticles() {
    const themeId = useThemeStore((s) => s.resolved.id);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const cfg = CONFIGS[themeId];
        if (!cfg) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let w = window.innerWidth;
        let h = window.innerHeight;
        canvas.width = w;
        canvas.height = h;

        const state = createTickState();

        const handleResize = () => {
            w = window.innerWidth; h = window.innerHeight;
            canvas.width = w; canvas.height = h;
            if (cfg.behavior === 'panel-edge') {
                state.panelElements = queryPanelElements();
            }
        };
        window.addEventListener('resize', handleResize);

        if (cfg.behavior === 'panel-edge') {
            state.panelElements = queryPanelElements();
        }

        const particles = Array.from({ length: cfg.count }, () => {
            const p = spawnParticle(cfg, w, h);
            if (cfg.behavior === 'panel-edge') placePanelEdgeParticle(p, cfg, state.panelElements);
            return p;
        });

        function loop() {
            try {
                tick(ctx!, particles, cfg!, w, h, state, themeId);
            } catch (e) {
                if (import.meta.env.DEV) console.warn('[ThemeParticles] tick error', e);
            }
            rafRef.current = requestAnimationFrame(loop);
        }

        rafRef.current = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(rafRef.current);
            window.removeEventListener('resize', handleResize);
            ctx.clearRect(0, 0, w, h);
        };
    }, [themeId]);

    if (!CONFIGS[themeId]) return null;

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}
        />
    );
}
