// ============================================================
// Creation helpers for UnderwaterAmbience (ROK-712)
// ============================================================

import type { Fish, FishSchool, Particle, LightShaft, CausticNode, Bubble } from './underwater-ambience.types';
import {
    FISH_PER_SCHOOL_MIN, FISH_PER_SCHOOL_MAX,
    LIGHT_SHAFT_COUNT, CAUSTIC_GRID, BUBBLE_COUNT,
    DEPTH_CONFIG,
} from './underwater-ambience.types';

export function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

export function randInt(min: number, max: number): number {
    return Math.floor(rand(min, max + 1));
}

export function createSchool(canvasW: number, canvasH: number, depth: number, direction: 1 | -1): FishSchool {
    const cfg = DEPTH_CONFIG[depth];
    const count = randInt(FISH_PER_SCHOOL_MIN, FISH_PER_SCHOOL_MAX);
    const baseX = direction === 1 ? rand(-200, -50) : rand(canvasW + 50, canvasW + 200);
    const baseY = rand(canvasH * 0.1, canvasH * 0.9);

    const fish: Fish[] = Array.from({ length: count }, () => {
        const y = baseY + rand(-30, 30);
        return {
            x: baseX + rand(-40, 40),
            y,
            size: rand(cfg.sizeRange[0], cfg.sizeRange[1]),
            speed: rand(cfg.speedRange[0], cfg.speedRange[1]),
            opacity: rand(cfg.opacityRange[0], cfg.opacityRange[1]),
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleSpeed: rand(0.01, 0.03),
            wobbleAmp: rand(3, 5),
            baseY: y,
        };
    });

    return { fish, depth, direction };
}

export function createParticle(canvasW: number, canvasH: number): Particle {
    return {
        x: rand(0, canvasW),
        y: rand(0, canvasH),
        size: rand(1, 2),
        speed: rand(0.1, 0.3),
        opacity: rand(0.04, 0.08),
        drift: 0,
        driftPhase: Math.random() * Math.PI * 2,
        driftSpeed: rand(0.005, 0.015),
    };
}

export function createLightShafts(canvasW: number): LightShaft[] {
    return Array.from({ length: LIGHT_SHAFT_COUNT }, () => ({
        x: rand(canvasW * 0.35, canvasW * 0.65),
        width: rand(500, 700),
        spread: rand(3.0, 4.5),
        opacity: rand(0.025, 0.04),
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: rand(0.0004, 0.001),
        swayAmp: rand(15, 40),
    }));
}

export function createCausticGrid(canvasW: number, canvasH: number): CausticNode[] {
    const nodes: CausticNode[] = [];
    const cellW = canvasW / CAUSTIC_GRID;
    const cellH = canvasH / CAUSTIC_GRID;
    for (let row = 0; row < CAUSTIC_GRID; row++) {
        for (let col = 0; col < CAUSTIC_GRID; col++) {
            nodes.push({
                x: cellW * (col + 0.5) + rand(-cellW * 0.3, cellW * 0.3),
                y: cellH * (row + 0.5) + rand(-cellH * 0.3, cellH * 0.3),
                radius: rand(40, 90),
                phase: Math.random() * Math.PI * 2,
                speed: rand(0.003, 0.008),
            });
        }
    }
    return nodes;
}

export function createBubbleCluster(canvasW: number, canvasH: number): Bubble[] {
    const cx = rand(canvasW * 0.1, canvasW * 0.9);
    const baseY = canvasH + rand(10, 40);
    return Array.from({ length: BUBBLE_COUNT }, () => ({
        x: cx + rand(-25, 25),
        y: baseY + rand(0, 80),
        radius: rand(2, 6),
        speed: rand(1.5, 3.0),
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: rand(0.015, 0.035),
        wobbleAmp: rand(4, 10),
        opacity: rand(0.06, 0.14),
    }));
}

export function respawnBubble(b: Bubble, canvasW: number, canvasH: number) {
    const cx = rand(canvasW * 0.1, canvasW * 0.9);
    b.x = cx + rand(-25, 25);
    b.y = canvasH + rand(10, 40);
    b.radius = rand(2, 6);
    b.speed = rand(1.5, 3.0);
    b.opacity = rand(0.06, 0.14);
}
