// ============================================================
// Types & Constants for UnderwaterAmbience (ROK-712)
// ============================================================

export interface Fish {
    x: number;
    y: number;
    size: number;
    speed: number;
    opacity: number;
    wobblePhase: number;
    wobbleSpeed: number;
    wobbleAmp: number;
    baseY: number;
}

export interface FishSchool {
    fish: Fish[];
    depth: number; // 0=far, 1=mid, 2=close
    direction: 1 | -1; // 1=right, -1=left
}

export interface Leviathan {
    x: number;
    y: number;
    width: number;
    height: number;
    speed: number;
    opacity: number;
    direction: 1 | -1;
    maxOpacity: number;
}

export interface Particle {
    x: number;
    y: number;
    size: number;
    speed: number;
    opacity: number;
    drift: number;
    driftPhase: number;
    driftSpeed: number;
}

export interface LightShaft {
    x: number;          // center x at top of canvas
    width: number;      // beam width at top
    spread: number;     // how much wider it gets at bottom (multiplier)
    opacity: number;    // max opacity
    swayPhase: number;  // current sway offset
    swaySpeed: number;  // sway oscillation speed
    swayAmp: number;    // sway amplitude in px
}

export interface CausticNode {
    x: number;
    y: number;
    radius: number;
    phase: number;
    speed: number;
}

export interface Bubble {
    x: number;
    y: number;
    radius: number;
    speed: number;
    wobblePhase: number;
    wobbleSpeed: number;
    wobbleAmp: number;
    opacity: number;
}

export const SCHOOL_COUNT = 3;
export const FISH_PER_SCHOOL_MIN = 3;
export const FISH_PER_SCHOOL_MAX = 7;
export const PARTICLE_COUNT = 25;
export const LEVIATHAN_MIN_INTERVAL = 45000; // ms
export const LEVIATHAN_MAX_INTERVAL = 90000; // ms
export const LIGHT_SHAFT_COUNT = 1;
export const BUBBLE_COUNT = 12;
export const CAUSTIC_GRID = 6; // NxN grid of caustic highlight nodes

export const DEPTH_CONFIG = [
    { sizeRange: [4, 6], speedRange: [0.15, 0.3], opacityRange: [0.04, 0.06] },   // far
    { sizeRange: [6, 9], speedRange: [0.3, 0.5], opacityRange: [0.06, 0.08] },     // mid
    { sizeRange: [9, 12], speedRange: [0.5, 0.8], opacityRange: [0.08, 0.10] },    // close
];
