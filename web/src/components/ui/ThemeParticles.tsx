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

// ─── Config ──────────────────────────────────────────────────────────────────

type Behavior = 'fall' | 'rise' | 'float' | 'firefly' | 'panel-edge';
type Shape = 'circle' | 'star';
type BgEffect = 'aurora' | 'lava' | 'sun';

interface ParticleConfig {
    count: number;
    colors: string[];
    behavior: Behavior;
    minSize: number;
    maxSize: number;
    minSpeed: number;
    maxSpeed: number;
    glow: boolean;
    glowRadius: number;
    shape: Shape;
    baseOpacity: number;
    drift: number;
    twinkle: boolean;
    bgEffect?: BgEffect;
}

const CONFIGS: Partial<Record<string, ParticleConfig>> = {
    arctic: {
        count: 35,
        colors: ['#FFFFFF', '#E0EEFF', '#B8D8F0', '#C8E8FF'],
        behavior: 'fall',
        minSize: 0.8,
        maxSize: 2,
        minSpeed: 0.4,
        maxSpeed: 1.2,
        glow: false,
        glowRadius: 0,
        shape: 'circle',
        baseOpacity: 0.65,
        drift: 0.25,
        twinkle: false,
        bgEffect: 'aurora',
    },
    ember: {
        count: 20,
        colors: ['#E8600A', '#FF7020', '#FF4400', '#FFB800', '#CC3300'],
        behavior: 'rise',
        minSize: 1.5,
        maxSize: 3.5,
        minSpeed: 0.7,
        maxSpeed: 1.8,
        glow: true,
        glowRadius: 6,
        shape: 'circle',
        baseOpacity: 0.9,
        drift: 0.5,
        twinkle: true,
        bgEffect: 'lava',
    },
    forest: {
        count: 8,
        colors: ['#00E5A0', '#39D98A', '#80FFB0', '#20FF90', '#AAFFCC'],
        behavior: 'firefly',
        minSize: 1.5,
        maxSize: 3,
        minSpeed: 1.8,
        maxSpeed: 4.5,
        glow: true,
        glowRadius: 12,
        shape: 'circle',
        baseOpacity: 0.95,
        drift: 0,
        twinkle: false,
    },
    fel: {
        count: 200,
        colors: ['#7FFF00', '#90FF20', '#AAFF40', '#60DD00', '#50CC00'],
        behavior: 'panel-edge',
        minSize: 1.2,
        maxSize: 2.8,
        minSpeed: 0.0002,
        maxSpeed: 0.0008,
        glow: true,
        glowRadius: 7,
        shape: 'circle',
        baseOpacity: 0.80,
        drift: 0,
        twinkle: true,
    },
    holy: {
        count: 80,
        colors: ['#B8860B', '#C8960A', '#DAA520', '#A07800', '#C09010'],
        behavior: 'panel-edge',
        minSize: 1.0,
        maxSize: 2.2,
        minSpeed: 0.0003,
        maxSpeed: 0.0009,
        glow: true,
        glowRadius: 6,
        shape: 'star',
        baseOpacity: 0.80,
        drift: 0,
        twinkle: true,
    },
    bloodmoon: {
        count: 15,
        colors: ['#CC2222', '#8B1A1A', '#FF2244', '#992020'],
        behavior: 'fall',
        minSize: 1,
        maxSize: 2.5,
        minSpeed: 0.3,
        maxSpeed: 0.9,
        glow: false,
        glowRadius: 0,
        shape: 'circle',
        baseOpacity: 0.45,
        drift: 0.2,
        twinkle: false,
    },
    celestial: {
        count: 18,
        colors: ['#A07820', '#C9A84C', '#B89030', '#8A6818'],
        behavior: 'float',
        minSize: 1,
        maxSize: 2.5,
        minSpeed: 0.08,
        maxSpeed: 0.25,
        glow: true,
        glowRadius: 4,
        shape: 'star',
        baseOpacity: 0.8,
        drift: 0.08,
        twinkle: true,
    },
    underwater: {
        count: 30,
        colors: ['#9ab8cc', '#22d3a0', '#6BAABF', '#B0D0E0'],
        behavior: 'rise',
        minSize: 2,
        maxSize: 5,
        minSpeed: 0.25,
        maxSpeed: 0.7,
        glow: false,
        glowRadius: 0,
        shape: 'circle',
        baseOpacity: 0.3,
        drift: 0.18,
        twinkle: false,
    },
    space: {
        count: 55,
        colors: ['#FFFFFF', '#C0C0E0', '#8b5cf6', '#D0C8FF', '#E0E8FF'],
        behavior: 'float',
        minSize: 0.8,
        maxSize: 2.2,
        minSpeed: 0.04,
        maxSpeed: 0.15,
        glow: true,
        glowRadius: 3,
        shape: 'circle',
        baseOpacity: 0.6,
        drift: 0.04,
        twinkle: true,
    },
    dawn: {
        count: 12,
        colors: ['#CC5500', '#D4780A', '#B84A00', '#E06820'],
        behavior: 'float',
        minSize: 1.5,
        maxSize: 3,
        minSpeed: 0.1,
        maxSpeed: 0.3,
        glow: true,
        glowRadius: 6,
        shape: 'circle',
        baseOpacity: 0.75,
        drift: 0.12,
        twinkle: true,
        bgEffect: 'sun',
    },
};

// ─── Particle state ───────────────────────────────────────────────────────────

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    colorIdx: number;
    alpha: number;
    phase: number;
    phaseSpeed: number;
    // Firefly-specific
    turnRate?: number;
    idleTimer?: number;
    lifeTimer?: number;
    maxLife?: number;
    // Panel-edge specific
    targetEl?: Element;
    edgeType?: 'top' | 'bottom' | 'left' | 'right';
    edgeT?: number;
    perpOffset?: number;
}

function rand(min: number, max: number) {
    return min + Math.random() * (max - min);
}

function spawnParticle(cfg: ParticleConfig, w: number, h: number): Particle {
    const speed = rand(cfg.minSpeed, cfg.maxSpeed);
    let x = rand(0, w);
    let y: number;
    let vy: number;
    let vx = rand(-cfg.drift, cfg.drift);

    if (cfg.behavior === 'fall') {
        y = rand(0, h);
        vy = speed;
    } else if (cfg.behavior === 'rise') {
        y = rand(0, h);
        vy = -speed;
    } else if (cfg.behavior === 'firefly') {
        const angle = rand(0, Math.PI * 2);
        y = rand(h * 0.2, h * 0.9);
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
    } else if (cfg.behavior === 'panel-edge') {
        y = rand(0, h); // placeholder — overridden by placePanelEdgeParticle
        vy = 0;
    } else {
        y = rand(0, h);
        vy = rand(-speed, speed) * 0.5;
        vx = rand(-cfg.drift, cfg.drift);
    }

    return {
        x, y, vx, vy,
        size: rand(cfg.minSize, cfg.maxSize),
        colorIdx: Math.floor(Math.random() * cfg.colors.length),
        alpha: (cfg.behavior === 'firefly' || cfg.behavior === 'panel-edge') ? 0 : rand(0.4, 1.0) * cfg.baseOpacity,
        phase: rand(0, Math.PI * 2),
        phaseSpeed: rand(0.01, 0.04),
        ...(cfg.behavior === 'firefly' ? {
            turnRate: rand(-0.07, 0.07),
            idleTimer: rand(0, 600),
            lifeTimer: 0,
            maxLife: rand(20, 45),
        } : {}),
    };
}

function resetParticle(p: Particle, cfg: ParticleConfig, w: number, h: number) {
    const speed = rand(cfg.minSpeed, cfg.maxSpeed);
    p.x = rand(0, w);
    p.colorIdx = Math.floor(Math.random() * cfg.colors.length);
    p.size = rand(cfg.minSize, cfg.maxSize);
    p.vx = rand(-cfg.drift, cfg.drift);
    p.phase = rand(0, Math.PI * 2);

    if (cfg.behavior === 'fall') {
        p.y = -p.size * 2;
        p.vy = speed;
        p.alpha = rand(0.4, 1.0) * cfg.baseOpacity;
    } else if (cfg.behavior === 'rise') {
        p.y = h + p.size * 2;
        p.vy = -speed;
        p.alpha = rand(0.4, 1.0) * cfg.baseOpacity;
    } else if (cfg.behavior === 'firefly') {
        p.x = rand(0, w);
        p.y = rand(h * 0.2, h * 0.9);
        const angle = rand(0, Math.PI * 2);
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.turnRate = rand(-0.07, 0.07);
        p.idleTimer = rand(100, 540);
        p.lifeTimer = 0;
        p.maxLife = rand(20, 45);
        p.alpha = 0;
    } else {
        p.x = rand(0, w);
        p.y = rand(0, h);
        p.vy = rand(-speed, speed) * 0.5;
        p.vx = rand(-cfg.drift, cfg.drift);
    }
}

// ─── Panel-edge helpers ───────────────────────────────────────────────────────

// Require "rounded" to exclude full-width layout elements (footer, header, nav bars)
// that share bg-surface/bg-panel but should never attract particles.
// Cards and panels always have rounded corners; layout wrappers do not.
const PANEL_SELECTOR = '[class*="bg-surface"][class*="rounded"],[class*="bg-panel"][class*="rounded"]';

function queryPanelElements(): Element[] {
    return Array.from(document.querySelectorAll(PANEL_SELECTOR)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 80 && r.height > 40;
    });
}

type EdgeType = 'top' | 'bottom' | 'left' | 'right';
const EDGES: EdgeType[] = ['top', 'bottom', 'left', 'right'];

function placePanelEdgeParticle(p: Particle, cfg: ParticleConfig, elements: Element[]) {
    // Only use elements that are currently visible — skip detached/zero-size ones
    let el: Element | null = null;
    if (elements.length > 0) {
        const start = Math.floor(Math.random() * elements.length);
        for (let i = 0; i < elements.length; i++) {
            const candidate = elements[(start + i) % elements.length];
            const r = candidate.getBoundingClientRect();
            if (r.width > 80 && r.height > 40) { el = candidate; break; }
        }
    }

    const edge = EDGES[Math.floor(Math.random() * 4)];
    const t = Math.random();
    const perp = (Math.random() - 0.5) * 8;

    p.targetEl = el ?? undefined;
    p.edgeType = edge;
    p.edgeT = t;
    p.perpOffset = perp;
    p.colorIdx = Math.floor(Math.random() * cfg.colors.length);
    p.size = rand(cfg.minSize, cfg.maxSize);
    p.alpha = rand(0.3, 1.0) * cfg.baseOpacity;
    p.phase = rand(0, Math.PI * 2);
    p.phaseSpeed = rand(0.008, 0.025);
    p.vx = rand(cfg.minSpeed, cfg.maxSpeed) * (Math.random() < 0.5 ? 1 : -1);
    p.vy = 0;

    if (el) {
        positionOnEdge(p, el.getBoundingClientRect());
    } else {
        // No valid element yet — park on the viewport border until re-query finds new panels
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        switch (edge) {
            case 'top':    p.x = t * vw;  p.y = Math.abs(perp);       break;
            case 'bottom': p.x = t * vw;  p.y = vh - Math.abs(perp);  break;
            case 'left':   p.x = Math.abs(perp);       p.y = t * vh;  break;
            case 'right':  p.x = vw - Math.abs(perp);  p.y = t * vh;  break;
        }
    }
}

function positionOnEdge(p: Particle, r: DOMRect) {
    const t = p.edgeT!;
    const perp = p.perpOffset!;
    switch (p.edgeType) {
        case 'top':    p.x = r.left + t * r.width;  p.y = r.top + perp;    break;
        case 'bottom': p.x = r.left + t * r.width;  p.y = r.bottom + perp; break;
        case 'left':   p.x = r.left + perp;          p.y = r.top + t * r.height; break;
        case 'right':  p.x = r.right + perp;         p.y = r.top + t * r.height; break;
    }
}

// ─── Background effects ───────────────────────────────────────────────────────

function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const bands = [
        { yCenter: h * 0.14, ySpread: h * 0.12, color: '#00FF88', speed: 0.28, freq: 0.006, phase: 0 },
        { yCenter: h * 0.20, ySpread: h * 0.10, color: '#22CCFF', speed: 0.22, freq: 0.005, phase: 2.1 },
        { yCenter: h * 0.10, ySpread: h * 0.08, color: '#9966FF', speed: 0.18, freq: 0.007, phase: 4.2 },
    ];

    ctx.save();
    for (const band of bands) {
        const alpha = 0.11 + Math.sin(t * 0.4 + band.phase) * 0.04;
        ctx.globalAlpha = alpha;

        ctx.beginPath();
        ctx.moveTo(0, band.yCenter - band.ySpread);
        for (let x = 0; x <= w; x += 6) {
            const wave = Math.sin(x * band.freq + t * band.speed + band.phase);
            ctx.lineTo(x, band.yCenter - band.ySpread + wave * band.ySpread * 0.5);
        }
        for (let x = w; x >= 0; x -= 6) {
            const wave = Math.sin(x * band.freq + t * band.speed + band.phase + 0.6);
            ctx.lineTo(x, band.yCenter + band.ySpread + wave * band.ySpread * 0.4);
        }
        ctx.closePath();

        // Gradual multi-stop gradient creates the diffused soft-edge look without a blur filter
        const grad = ctx.createLinearGradient(0, band.yCenter - band.ySpread, 0, band.yCenter + band.ySpread);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.15, `${band.color}18`);
        grad.addColorStop(0.35, `${band.color}80`);
        grad.addColorStop(0.5, band.color);
        grad.addColorStop(0.65, `${band.color}80`);
        grad.addColorStop(0.85, `${band.color}18`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fill();
    }
    ctx.restore();
}

function drawLavaGlow(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    ctx.save();

    // Full-width base glow — pulses between dim and bright
    const pulse = 0.5 + Math.sin(t * 0.9) * 0.5; // 0→1 oscillator
    const baseAlpha = 0.14 + pulse * 0.18; // 0.14–0.32
    const baseGrad = ctx.createLinearGradient(0, h * 0.62, 0, h);
    baseGrad.addColorStop(0, 'transparent');
    baseGrad.addColorStop(0.4, `rgba(160, 30, 0, ${baseAlpha * 0.5})`);
    baseGrad.addColorStop(1, `rgba(240, 70, 0, ${baseAlpha})`);
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, h * 0.62, w, h * 0.38);

    // Pulsing hot-spots — each on a different phase so they breathe independently
    const spots = [
        { xFrac: 0.15, intensity: 0.45 + Math.sin(t * 1.1) * 0.35 },
        { xFrac: 0.45, intensity: 0.40 + Math.sin(t * 0.9 + 1.2) * 0.35 },
        { xFrac: 0.75, intensity: 0.42 + Math.sin(t * 1.0 + 2.4) * 0.35 },
    ];
    for (const spot of spots) {
        const sx = w * spot.xFrac;
        const r = w * 0.32;
        const rg = ctx.createRadialGradient(sx, h, 0, sx, h, r);
        rg.addColorStop(0, `rgba(255, 90, 0, ${spot.intensity * 0.35})`);
        rg.addColorStop(0.35, `rgba(200, 40, 0, ${spot.intensity * 0.18})`);
        rg.addColorStop(0.7, `rgba(120, 15, 0, ${spot.intensity * 0.07})`);
        rg.addColorStop(1, 'transparent');
        ctx.globalAlpha = 1;
        ctx.fillStyle = rg;
        ctx.fillRect(0, h * 0.5, w, h * 0.5);
    }

    ctx.restore();
}

function drawSun(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const sx = w * 0.12;
    const sy = h * 0.10;
    const base = Math.min(w, h) * 0.07;
    const pulse = 1 + Math.sin(t * 0.28) * 0.04;

    ctx.save();

    // Outer bloom
    const bloom = ctx.createRadialGradient(sx, sy, 0, sx, sy, base * 5 * pulse);
    bloom.addColorStop(0, 'rgba(255, 200, 60, 0.14)');
    bloom.addColorStop(0.25, 'rgba(255, 160, 40, 0.09)');
    bloom.addColorStop(0.55, 'rgba(240, 110, 20, 0.04)');
    bloom.addColorStop(1, 'transparent');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(sx, sy, base * 5 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Mid halo
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, base * 2.2 * pulse);
    halo.addColorStop(0, 'rgba(255, 220, 100, 0.30)');
    halo.addColorStop(0.5, 'rgba(255, 170, 50, 0.18)');
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, base * 2.2 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Core disc
    const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, base * pulse);
    core.addColorStop(0, 'rgba(255, 240, 180, 0.55)');
    core.addColorStop(0.5, 'rgba(255, 200, 80, 0.40)');
    core.addColorStop(1, 'transparent');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, sy, base * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    const points = 4;
    const outer = size;
    const inner = size * 0.4;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const angle = (i * Math.PI) / points - Math.PI / 2;
        const r = i % 2 === 0 ? outer : inner;
        if (i === 0) ctx.moveTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
        else ctx.lineTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fill();
}

// ─── Component ────────────────────────────────────────────────────────────────

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

        const handleResize = () => {
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = w;
            canvas.height = h;
            if (cfg.behavior === 'panel-edge') {
                panelElements = queryPanelElements();
            }
        };
        window.addEventListener('resize', handleResize);

        // Panel-edge: query DOM elements and place particles on their borders
        let panelElements: Element[] = [];
        if (cfg.behavior === 'panel-edge') {
            panelElements = queryPanelElements();
        }

        const particles: Particle[] = Array.from({ length: cfg.count }, () => {
            const p = spawnParticle(cfg, w, h);
            if (cfg.behavior === 'panel-edge') {
                placePanelEdgeParticle(p, cfg, panelElements);
            }
            return p;
        });

        let time = 0;
        let frameCount = 0;
        const rectCache = new Map<Element, DOMRect>();

        function tick() {
            try {
            time += 0.016; // ~60fps increment
            frameCount++;
            rectCache.clear();

            // Re-query panel elements every ~167ms (6×/sec) — catches navigation + infinite scroll
            if (cfg!.behavior === 'panel-edge') {
                if (frameCount % 10 === 0) {
                    const fresh = queryPanelElements();
                    const prevElCount = panelElements.length;
                    panelElements = fresh; // always update — clears stale refs on navigation
                    if (fresh.length > 0) {
                        if (fresh.length !== prevElCount) {
                            // Element count changed (navigation or scroll loaded new cards) —
                            // redistribute ALL particles so new panels get their proportional share
                            for (const rp of particles) {
                                placePanelEdgeParticle(rp, cfg!, panelElements);
                            }
                        } else {
                            // Same element count — only re-anchor unanchored particles
                            for (const rp of particles) {
                                if (!rp.targetEl) placePanelEdgeParticle(rp, cfg!, panelElements);
                            }
                        }
                    }
                }
            }

            ctx!.filter = 'none'; // ensure no lingering filter from bg effects
            ctx!.clearRect(0, 0, w, h);

            // Background effect
            if (cfg!.bgEffect === 'aurora') drawAurora(ctx!, w, h, time);
            if (cfg!.bgEffect === 'lava') drawLavaGlow(ctx!, w, h, time);
            if (cfg!.bgEffect === 'sun') drawSun(ctx!, w, h, time);

            // Particles
            for (const p of particles) {
                // Firefly — zip in curved arc, fade in/out rapidly
                if (cfg!.behavior === 'firefly') {
                    if ((p.idleTimer ?? 0) > 0) {
                        p.idleTimer!--;
                        continue;
                    }
                    p.lifeTimer = (p.lifeTimer ?? 0) + 1;
                    // Curve the path by rotating velocity each frame
                    const ct = Math.cos(p.turnRate ?? 0);
                    const st = Math.sin(p.turnRate ?? 0);
                    const nvx = p.vx * ct - p.vy * st;
                    const nvy = p.vx * st + p.vy * ct;
                    p.vx = nvx;
                    p.vy = nvy;
                    p.x += p.vx;
                    p.y += p.vy;
                    // Bell-curve opacity: snap on, rapid fade out
                    const progress = p.lifeTimer / (p.maxLife ?? 35);
                    p.alpha = Math.sin(progress * Math.PI) * cfg!.baseOpacity;
                    if (p.lifeTimer >= (p.maxLife ?? 35) || p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) {
                        resetParticle(p, cfg!, w, h);
                        continue;
                    }
                    const color = cfg!.colors[p.colorIdx];
                    ctx!.globalAlpha = Math.max(0, Math.min(1, p.alpha));
                    ctx!.shadowBlur = cfg!.glowRadius * 2;
                    ctx!.shadowColor = color;
                    ctx!.fillStyle = color;
                    ctx!.beginPath();
                    ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx!.fill();
                    continue;
                }

                // Panel-edge — particles cling to panel borders and barely move
                if (cfg!.behavior === 'panel-edge') {
                    // Unanchored particles hide silently until the next re-query anchors them.
                    // (Calling placePanelEdgeParticle per-frame would reset phase/position every
                    // frame, causing flickering and broken alpha. Re-anchor happens in the
                    // re-query block above instead.)
                    if (!p.targetEl) {
                        continue;
                    }
                    const el = p.targetEl;
                    if (el) {
                        if (!rectCache.has(el)) rectCache.set(el, el.getBoundingClientRect());
                        const r = rectCache.get(el)!;
                        // Element collapsed or detached — reassign
                        if (r.width < 10 || r.height < 10) {
                            placePanelEdgeParticle(p, cfg!, panelElements);
                        } else if (r.bottom < -20 || r.top > h + 20 || r.right < -20 || r.left > w + 20) {
                            // Element scrolled off-screen — hide this particle but keep the assignment
                            p.phase += p.phaseSpeed;
                            continue;
                        } else {
                            // Element visible — update position
                            p.edgeT = ((p.edgeT! + p.vx) + 1) % 1;
                            positionOnEdge(p, r);
                            p.x += Math.sin(p.phase * 1.1) * 1.5;
                            p.y += Math.cos(p.phase * 0.9) * 1.5;
                        }
                    }
                    p.phase += p.phaseSpeed;
                    if (cfg!.twinkle) {
                        // 0.55 ± 0.45 keeps alpha in [0.08, 1.0] * baseOpacity — never fully invisible
                        p.alpha = cfg!.baseOpacity * (0.55 + Math.sin(p.phase * 1.8) * 0.45);
                    }
                    const color = cfg!.colors[p.colorIdx];
                    ctx!.globalAlpha = Math.max(0, Math.min(1, p.alpha));
                    ctx!.shadowBlur = cfg!.glowRadius;
                    ctx!.shadowColor = color;
                    ctx!.fillStyle = color;
                    if (cfg!.shape === 'star') {
                        drawStar(ctx!, p.x, p.y, p.size);
                    } else {
                        ctx!.beginPath();
                        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                        ctx!.fill();
                    }
                    continue;
                }

                p.phase += p.phaseSpeed;
                p.x += p.vx + Math.sin(p.phase) * cfg!.drift * 0.5;
                p.y += p.vy;

                if (cfg!.twinkle) {
                    p.alpha = cfg!.baseOpacity * 0.7 + Math.sin(p.phase * 1.5) * cfg!.baseOpacity * 0.3;
                }

                const oob =
                    (cfg!.behavior === 'fall' && p.y > h + p.size * 2) ||
                    (cfg!.behavior === 'rise' && p.y < -p.size * 2) ||
                    p.x < -p.size * 4 ||
                    p.x > w + p.size * 4;

                if (oob) {
                    resetParticle(p, cfg!, w, h);
                    continue;
                }

                const color = cfg!.colors[p.colorIdx];
                ctx!.globalAlpha = Math.max(0, Math.min(1, p.alpha));

                if (cfg!.glow) {
                    ctx!.shadowBlur = cfg!.glowRadius;
                    ctx!.shadowColor = color;
                } else {
                    ctx!.shadowBlur = 0;
                }

                ctx!.fillStyle = color;

                if (cfg!.shape === 'star') {
                    drawStar(ctx!, p.x, p.y, p.size);
                } else {
                    ctx!.beginPath();
                    if (themeId === 'ember') {
                        ctx!.ellipse(p.x, p.y, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
                    } else {
                        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    }
                    ctx!.fill();
                }
            }

            ctx!.shadowBlur = 0;
            ctx!.globalAlpha = 1;
            } catch (e) {
                // Swallow errors so the RAF loop never dies silently
                if (import.meta.env.DEV) console.warn('[ThemeParticles] tick error', e);
            }
            rafRef.current = requestAnimationFrame(tick);
        }

        rafRef.current = requestAnimationFrame(tick);

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
            style={{
                position: 'fixed',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 0,
            }}
        />
    );
}
