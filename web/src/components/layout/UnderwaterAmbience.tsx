import { useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/theme-store';

// ============================================================
// Types
// ============================================================

interface Fish {
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

interface FishSchool {
    fish: Fish[];
    depth: number; // 0=far, 1=mid, 2=close
    direction: 1 | -1; // 1=right, -1=left
}

interface Leviathan {
    x: number;
    y: number;
    width: number;
    height: number;
    speed: number;
    opacity: number;
    direction: 1 | -1;
    maxOpacity: number;
}

interface Particle {
    x: number;
    y: number;
    size: number;
    speed: number;
    opacity: number;
    drift: number;
    driftPhase: number;
    driftSpeed: number;
}

// ============================================================
// Constants
// ============================================================

const SCHOOL_COUNT = 3;
const FISH_PER_SCHOOL_MIN = 3;
const FISH_PER_SCHOOL_MAX = 7;
const PARTICLE_COUNT = 25;
const LEVIATHAN_MIN_INTERVAL = 45000; // ms
const LEVIATHAN_MAX_INTERVAL = 90000; // ms

const DEPTH_CONFIG = [
    { sizeRange: [4, 6], speedRange: [0.15, 0.3], opacityRange: [0.04, 0.06] },   // far
    { sizeRange: [6, 9], speedRange: [0.3, 0.5], opacityRange: [0.06, 0.08] },     // mid
    { sizeRange: [9, 12], speedRange: [0.5, 0.8], opacityRange: [0.08, 0.10] },    // close
];

// ============================================================
// Helpers
// ============================================================

function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
    return Math.floor(rand(min, max + 1));
}

function createSchool(canvasW: number, canvasH: number, depth: number, direction: 1 | -1): FishSchool {
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

function createParticle(canvasW: number, canvasH: number): Particle {
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

function drawFishSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, direction: 1 | -1, opacity: number) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#4a6a80';
    ctx.translate(x, y);
    if (direction === -1) ctx.scale(-1, 1);

    // Simple fish body: ellipse + tail
    const bodyW = size;
    const bodyH = size * 0.45;
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail fin
    ctx.beginPath();
    ctx.moveTo(-bodyW / 2, 0);
    ctx.lineTo(-bodyW / 2 - size * 0.35, -bodyH * 0.6);
    ctx.lineTo(-bodyW / 2 - size * 0.35, bodyH * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function drawLeviathan(ctx: CanvasRenderingContext2D, lev: Leviathan) {
    ctx.save();
    ctx.globalAlpha = lev.opacity;
    ctx.fillStyle = '#0a1628';

    // Amorphous elongated shape
    ctx.beginPath();
    ctx.ellipse(lev.x, lev.y, lev.width / 2, lev.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail taper
    const tailDir = lev.direction === 1 ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(
        lev.x + tailDir * lev.width * 0.45,
        lev.y,
        lev.width * 0.2,
        lev.height * 0.3,
        0, 0, Math.PI * 2,
    );
    ctx.fill();

    ctx.restore();
}

// ============================================================
// Component
// ============================================================

/**
 * Canvas-based ambient underwater effects for the Deep Sea dark theme (ROK-296).
 * Renders schools of fish, occasional leviathan shadows, and floating particles.
 * Only active when the resolved theme is 'underwater'.
 * pointer-events: none so it never blocks interaction.
 */
export function UnderwaterAmbience() {
    const resolved = useThemeStore((s) => s.resolved);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const schoolsRef = useRef<FishSchool[]>([]);
    const particlesRef = useRef<Particle[]>([]);
    const leviathanRef = useRef<Leviathan | null>(null);
    const nextLeviathanRef = useRef<number>(0);
    const hiddenRef = useRef(false);

    const isUnderwater = resolved.id === 'underwater';

    useEffect(() => {
        if (!isUnderwater) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        function resize() {
            if (!canvas) return;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        // Visibility handler — pause when tab is hidden
        function onVisibility() {
            hiddenRef.current = document.hidden;
        }
        document.addEventListener('visibilitychange', onVisibility);

        // Initialize schools
        schoolsRef.current = Array.from({ length: SCHOOL_COUNT }, (_, i) => {
            const depth = i % 3;
            const direction = Math.random() > 0.5 ? 1 : -1 as 1 | -1;
            return createSchool(canvas.width, canvas.height, depth, direction);
        });

        // Initialize particles
        particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () =>
            createParticle(canvas.width, canvas.height),
        );

        // Schedule first leviathan
        nextLeviathanRef.current = performance.now() +
            rand(LEVIATHAN_MIN_INTERVAL, LEVIATHAN_MAX_INTERVAL);

        function animate(now: number) {
            if (!canvas || !ctx) return;

            // Skip rendering when tab is hidden
            if (hiddenRef.current) {
                animRef.current = requestAnimationFrame(animate);
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // --- Draw & update particles ---
            for (const p of particlesRef.current) {
                p.driftPhase += p.driftSpeed;
                p.drift = Math.sin(p.driftPhase) * 1.5;
                p.y -= p.speed;
                p.x += p.drift * 0.1;

                if (p.y < -5) {
                    p.y = canvas.height + 5;
                    p.x = rand(0, canvas.width);
                }

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(180, 220, 240, ${p.opacity.toFixed(3)})`;
                ctx.fill();
            }

            // --- Draw & update fish schools ---
            for (let si = 0; si < schoolsRef.current.length; si++) {
                const school = schoolsRef.current[si];
                let allOffscreen = true;

                for (const fish of school.fish) {
                    fish.wobblePhase += fish.wobbleSpeed;
                    fish.x += fish.speed * school.direction;
                    fish.y = fish.baseY + Math.sin(fish.wobblePhase) * fish.wobbleAmp;

                    // Check if still on screen (with margin)
                    if (fish.x > -250 && fish.x < canvas.width + 250) {
                        allOffscreen = false;
                    }

                    drawFishSilhouette(ctx, fish.x, fish.y, fish.size, school.direction, fish.opacity);
                }

                // Respawn school when it fully exits
                if (allOffscreen) {
                    const depth = randInt(0, 2);
                    const direction = Math.random() > 0.5 ? 1 : -1 as 1 | -1;
                    schoolsRef.current[si] = createSchool(canvas.width, canvas.height, depth, direction);
                }
            }

            // --- Leviathan shadow ---
            if (!leviathanRef.current && now >= nextLeviathanRef.current) {
                const direction = Math.random() > 0.5 ? 1 : -1 as 1 | -1;
                const width = rand(200, 400);
                leviathanRef.current = {
                    x: direction === 1 ? -width : canvas.width + width,
                    y: rand(canvas.height * 0.2, canvas.height * 0.8),
                    width,
                    height: width * rand(0.15, 0.25),
                    speed: rand(0.8, 1.5),
                    opacity: 0,
                    direction,
                    maxOpacity: rand(0.03, 0.05),
                };
            }

            if (leviathanRef.current) {
                const lev = leviathanRef.current;
                lev.x += lev.speed * lev.direction;

                // Fade in/out
                const distFromEdge = lev.direction === 1
                    ? lev.x + lev.width / 2
                    : canvas.width - (lev.x - lev.width / 2);
                if (distFromEdge < canvas.width * 0.3) {
                    lev.opacity = Math.min(lev.opacity + 0.0005, lev.maxOpacity);
                } else {
                    lev.opacity = Math.max(lev.opacity - 0.0003, 0);
                }

                drawLeviathan(ctx, lev);

                // Remove when fully off-screen
                const offscreen = lev.direction === 1
                    ? lev.x - lev.width / 2 > canvas.width + 50
                    : lev.x + lev.width / 2 < -50;
                if (offscreen) {
                    leviathanRef.current = null;
                    nextLeviathanRef.current = now + rand(LEVIATHAN_MIN_INTERVAL, LEVIATHAN_MAX_INTERVAL);
                }
            }

            animRef.current = requestAnimationFrame(animate);
        }

        animRef.current = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animRef.current);
            window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [isUnderwater]);

    if (!isUnderwater) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 w-full h-full pointer-events-none z-0"
            aria-hidden="true"
        />
    );
}
