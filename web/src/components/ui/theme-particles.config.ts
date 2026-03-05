export type Behavior = 'fall' | 'rise' | 'float' | 'firefly' | 'panel-edge';
export type Shape = 'circle' | 'star';
export type BgEffect = 'aurora' | 'lava' | 'sun';

export interface ParticleConfig {
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

export const CONFIGS: Partial<Record<string, ParticleConfig>> = {
    arctic: {
        count: 35, colors: ['#FFFFFF', '#E0EEFF', '#B8D8F0', '#C8E8FF'],
        behavior: 'fall', minSize: 0.8, maxSize: 2, minSpeed: 0.4, maxSpeed: 1.2,
        glow: false, glowRadius: 0, shape: 'circle', baseOpacity: 0.65, drift: 0.25,
        twinkle: false, bgEffect: 'aurora',
    },
    ember: {
        count: 20, colors: ['#E8600A', '#FF7020', '#FF4400', '#FFB800', '#CC3300'],
        behavior: 'rise', minSize: 1.5, maxSize: 3.5, minSpeed: 0.7, maxSpeed: 1.8,
        glow: true, glowRadius: 6, shape: 'circle', baseOpacity: 0.9, drift: 0.5,
        twinkle: true, bgEffect: 'lava',
    },
    forest: {
        count: 8, colors: ['#00E5A0', '#39D98A', '#80FFB0', '#20FF90', '#AAFFCC'],
        behavior: 'firefly', minSize: 1.5, maxSize: 3, minSpeed: 1.8, maxSpeed: 4.5,
        glow: true, glowRadius: 12, shape: 'circle', baseOpacity: 0.95, drift: 0,
        twinkle: false,
    },
    fel: {
        count: 200, colors: ['#7FFF00', '#90FF20', '#AAFF40', '#60DD00', '#50CC00'],
        behavior: 'panel-edge', minSize: 1.2, maxSize: 2.8, minSpeed: 0.0002, maxSpeed: 0.0008,
        glow: true, glowRadius: 7, shape: 'circle', baseOpacity: 0.80, drift: 0,
        twinkle: true,
    },
    holy: {
        count: 80, colors: ['#B8860B', '#C8960A', '#DAA520', '#A07800', '#C09010'],
        behavior: 'panel-edge', minSize: 1.0, maxSize: 2.2, minSpeed: 0.0003, maxSpeed: 0.0009,
        glow: true, glowRadius: 6, shape: 'star', baseOpacity: 0.80, drift: 0,
        twinkle: true,
    },
    bloodmoon: {
        count: 15, colors: ['#CC2222', '#8B1A1A', '#FF2244', '#992020'],
        behavior: 'fall', minSize: 1, maxSize: 2.5, minSpeed: 0.3, maxSpeed: 0.9,
        glow: false, glowRadius: 0, shape: 'circle', baseOpacity: 0.45, drift: 0.2,
        twinkle: false,
    },
    celestial: {
        count: 18, colors: ['#A07820', '#C9A84C', '#B89030', '#8A6818'],
        behavior: 'float', minSize: 1, maxSize: 2.5, minSpeed: 0.08, maxSpeed: 0.25,
        glow: true, glowRadius: 4, shape: 'star', baseOpacity: 0.8, drift: 0.08,
        twinkle: true,
    },
    underwater: {
        count: 30, colors: ['#9ab8cc', '#22d3a0', '#6BAABF', '#B0D0E0'],
        behavior: 'rise', minSize: 2, maxSize: 5, minSpeed: 0.25, maxSpeed: 0.7,
        glow: false, glowRadius: 0, shape: 'circle', baseOpacity: 0.3, drift: 0.18,
        twinkle: false,
    },
    space: {
        count: 55, colors: ['#FFFFFF', '#C0C0E0', '#8b5cf6', '#D0C8FF', '#E0E8FF'],
        behavior: 'float', minSize: 0.8, maxSize: 2.2, minSpeed: 0.04, maxSpeed: 0.15,
        glow: true, glowRadius: 3, shape: 'circle', baseOpacity: 0.6, drift: 0.04,
        twinkle: true,
    },
    dawn: {
        count: 12, colors: ['#CC5500', '#D4780A', '#B84A00', '#E06820'],
        behavior: 'float', minSize: 1.5, maxSize: 3, minSpeed: 0.1, maxSpeed: 0.3,
        glow: true, glowRadius: 6, shape: 'circle', baseOpacity: 0.75, drift: 0.12,
        twinkle: true, bgEffect: 'sun',
    },
};
