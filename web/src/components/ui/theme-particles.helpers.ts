import type { ParticleConfig } from './theme-particles.config';

export interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    colorIdx: number;
    alpha: number;
    phase: number;
    phaseSpeed: number;
    turnRate?: number;
    idleTimer?: number;
    lifeTimer?: number;
    maxLife?: number;
    targetEl?: Element;
    edgeType?: 'top' | 'bottom' | 'left' | 'right';
    edgeT?: number;
    perpOffset?: number;
}

export function rand(min: number, max: number) {
    return min + Math.random() * (max - min);
}

export function spawnParticle(cfg: ParticleConfig, w: number, h: number): Particle {
    const speed = rand(cfg.minSpeed, cfg.maxSpeed);
    const x = rand(0, w);
    let y: number;
    let vy: number;
    let vx = rand(-cfg.drift, cfg.drift);

    if (cfg.behavior === 'fall') {
        y = rand(0, h); vy = speed;
    } else if (cfg.behavior === 'rise') {
        y = rand(0, h); vy = -speed;
    } else if (cfg.behavior === 'firefly') {
        const angle = rand(0, Math.PI * 2);
        y = rand(h * 0.2, h * 0.9);
        vx = Math.cos(angle) * speed; vy = Math.sin(angle) * speed;
    } else if (cfg.behavior === 'panel-edge') {
        y = rand(0, h); vy = 0;
    } else {
        y = rand(0, h); vy = rand(-speed, speed) * 0.5; vx = rand(-cfg.drift, cfg.drift);
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

export function resetParticle(p: Particle, cfg: ParticleConfig, w: number, h: number) {
    const speed = rand(cfg.minSpeed, cfg.maxSpeed);
    p.x = rand(0, w);
    p.colorIdx = Math.floor(Math.random() * cfg.colors.length);
    p.size = rand(cfg.minSize, cfg.maxSize);
    p.vx = rand(-cfg.drift, cfg.drift);
    p.phase = rand(0, Math.PI * 2);

    if (cfg.behavior === 'fall') {
        p.y = -p.size * 2; p.vy = speed;
        p.alpha = rand(0.4, 1.0) * cfg.baseOpacity;
    } else if (cfg.behavior === 'rise') {
        p.y = h + p.size * 2; p.vy = -speed;
        p.alpha = rand(0.4, 1.0) * cfg.baseOpacity;
    } else if (cfg.behavior === 'firefly') {
        p.x = rand(0, w); p.y = rand(h * 0.2, h * 0.9);
        const angle = rand(0, Math.PI * 2);
        p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
        p.turnRate = rand(-0.07, 0.07); p.idleTimer = rand(100, 540);
        p.lifeTimer = 0; p.maxLife = rand(20, 45); p.alpha = 0;
    } else {
        p.x = rand(0, w); p.y = rand(0, h);
        p.vy = rand(-speed, speed) * 0.5; p.vx = rand(-cfg.drift, cfg.drift);
    }
}

// Panel-edge helpers
const PANEL_SELECTOR = '[class*="bg-surface"][class*="rounded"],[class*="bg-panel"][class*="rounded"]';

export function queryPanelElements(): Element[] {
    return Array.from(document.querySelectorAll(PANEL_SELECTOR)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 80 && r.height > 40;
    });
}

type EdgeType = 'top' | 'bottom' | 'left' | 'right';
const EDGES: EdgeType[] = ['top', 'bottom', 'left', 'right'];

export function positionOnEdge(p: Particle, r: DOMRect) {
    const t = p.edgeT!;
    const perp = p.perpOffset!;
    switch (p.edgeType) {
        case 'top':    p.x = r.left + t * r.width;  p.y = r.top + perp;    break;
        case 'bottom': p.x = r.left + t * r.width;  p.y = r.bottom + perp; break;
        case 'left':   p.x = r.left + perp;          p.y = r.top + t * r.height; break;
        case 'right':  p.x = r.right + perp;         p.y = r.top + t * r.height; break;
    }
}

export function placePanelEdgeParticle(p: Particle, cfg: ParticleConfig, elements: Element[]) {
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
