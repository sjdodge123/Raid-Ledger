import type { ParticleConfig } from './theme-particles.config';
import type { Particle } from './theme-particles.helpers';
import { resetParticle, positionOnEdge, placePanelEdgeParticle, queryPanelElements } from './theme-particles.helpers';
import { drawAurora, drawLavaGlow, drawSun, drawStar } from './theme-particles.effects';

interface TickState {
    time: number;
    frameCount: number;
    panelElements: Element[];
}

export function createTickState(): TickState {
    return { time: 0, frameCount: 0, panelElements: [] };
}

function refreshPanelEdgeElements(
    particles: Particle[], cfg: ParticleConfig, state: TickState,
) {
    const fresh = queryPanelElements();
    const prevCount = state.panelElements.length;
    state.panelElements = fresh;
    if (fresh.length > 0) {
        if (fresh.length !== prevCount) {
            for (const rp of particles) placePanelEdgeParticle(rp, cfg, state.panelElements);
        } else {
            for (const rp of particles) {
                if (!rp.targetEl) placePanelEdgeParticle(rp, cfg, state.panelElements);
            }
        }
    }
}

function drawBgEffects(ctx: CanvasRenderingContext2D, cfg: ParticleConfig, w: number, h: number, t: number) {
    if (cfg.bgEffect === 'aurora') drawAurora(ctx, w, h, t);
    if (cfg.bgEffect === 'lava') drawLavaGlow(ctx, w, h, t);
    if (cfg.bgEffect === 'sun') drawSun(ctx, w, h, t);
}

export function tick(
    ctx: CanvasRenderingContext2D, particles: Particle[], cfg: ParticleConfig,
    w: number, h: number, state: TickState, themeId: string,
) {
    state.time += 0.016;
    state.frameCount++;
    const rectCache = new Map<Element, DOMRect>();

    if (cfg.behavior === 'panel-edge' && state.frameCount % 10 === 0) {
        refreshPanelEdgeElements(particles, cfg, state);
    }

    ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    drawBgEffects(ctx, cfg, w, h, state.time);

    for (const p of particles) {
        if (cfg.behavior === 'firefly') { tickFirefly(ctx, p, cfg, w, h); continue; }
        if (cfg.behavior === 'panel-edge') { tickPanelEdge(ctx, p, cfg, h, rectCache, state.panelElements); continue; }
        tickDefault(ctx, p, cfg, w, h, themeId);
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
}

function tickFirefly(ctx: CanvasRenderingContext2D, p: Particle, cfg: ParticleConfig, w: number, h: number) {
    if ((p.idleTimer ?? 0) > 0) { p.idleTimer!--; return; }
    p.lifeTimer = (p.lifeTimer ?? 0) + 1;
    const ct = Math.cos(p.turnRate ?? 0);
    const st = Math.sin(p.turnRate ?? 0);
    const nvx = p.vx * ct - p.vy * st;
    const nvy = p.vx * st + p.vy * ct;
    p.vx = nvx; p.vy = nvy;
    p.x += p.vx; p.y += p.vy;
    const progress = p.lifeTimer / (p.maxLife ?? 35);
    p.alpha = Math.sin(progress * Math.PI) * cfg.baseOpacity;
    if (p.lifeTimer >= (p.maxLife ?? 35) || p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) {
        resetParticle(p, cfg, w, h); return;
    }
    const color = cfg.colors[p.colorIdx];
    ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
    ctx.shadowBlur = cfg.glowRadius * 2;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, cfg: ParticleConfig) {
    const color = cfg.colors[p.colorIdx];
    ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
    ctx.shadowBlur = cfg.glowRadius;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    if (cfg.shape === 'star') { drawStar(ctx, p.x, p.y, p.size); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
}

function movePanelEdge(p: Particle, r: DOMRect, cfg: ParticleConfig, h: number, panelElements: Element[]) {
    const w = window.innerWidth;
    if (r.width < 10 || r.height < 10) {
        placePanelEdgeParticle(p, cfg, panelElements);
    } else if (r.bottom < -20 || r.top > h + 20 || r.right < -20 || r.left > w + 20) {
        p.phase += p.phaseSpeed; return false;
    } else {
        p.edgeT = ((p.edgeT! + p.vx) + 1) % 1;
        positionOnEdge(p, r);
        p.x += Math.sin(p.phase * 1.1) * 1.5;
        p.y += Math.cos(p.phase * 0.9) * 1.5;
    }
    return true;
}

function tickPanelEdge(
    ctx: CanvasRenderingContext2D, p: Particle, cfg: ParticleConfig,
    h: number, rectCache: Map<Element, DOMRect>, panelElements: Element[],
) {
    if (!p.targetEl) return;
    const el = p.targetEl;
    if (!rectCache.has(el)) rectCache.set(el, el.getBoundingClientRect());
    const r = rectCache.get(el)!;

    if (!movePanelEdge(p, r, cfg, h, panelElements)) return;

    p.phase += p.phaseSpeed;
    if (cfg.twinkle) p.alpha = cfg.baseOpacity * (0.55 + Math.sin(p.phase * 1.8) * 0.45);
    drawParticle(ctx, p, cfg);
}

function isOutOfBounds(p: Particle, cfg: ParticleConfig, w: number, h: number) {
    return (cfg.behavior === 'fall' && p.y > h + p.size * 2) ||
        (cfg.behavior === 'rise' && p.y < -p.size * 2) ||
        p.x < -p.size * 4 || p.x > w + p.size * 4;
}

function tickDefault(
    ctx: CanvasRenderingContext2D, p: Particle, cfg: ParticleConfig,
    w: number, h: number, themeId: string,
) {
    p.phase += p.phaseSpeed;
    p.x += p.vx + Math.sin(p.phase) * cfg.drift * 0.5;
    p.y += p.vy;
    if (cfg.twinkle) {
        p.alpha = cfg.baseOpacity * 0.7 + Math.sin(p.phase * 1.5) * cfg.baseOpacity * 0.3;
    }
    if (isOutOfBounds(p, cfg, w, h)) { resetParticle(p, cfg, w, h); return; }

    const color = cfg.colors[p.colorIdx];
    ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
    if (cfg.glow) { ctx.shadowBlur = cfg.glowRadius; ctx.shadowColor = color; }
    else { ctx.shadowBlur = 0; }
    ctx.fillStyle = color;
    if (cfg.shape === 'star') { drawStar(ctx, p.x, p.y, p.size); }
    else {
        ctx.beginPath();
        if (themeId === 'ember') ctx.ellipse(p.x, p.y, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
        else ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
}
