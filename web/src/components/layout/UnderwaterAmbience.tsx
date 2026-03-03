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

interface LightShaft {
    x: number;          // center x at top of canvas
    width: number;      // beam width at top
    spread: number;     // how much wider it gets at bottom (multiplier)
    opacity: number;    // max opacity
    swayPhase: number;  // current sway offset
    swaySpeed: number;  // sway oscillation speed
    swayAmp: number;    // sway amplitude in px
}

interface CausticNode {
    x: number;
    y: number;
    radius: number;
    phase: number;
    speed: number;
}

interface Bubble {
    x: number;
    y: number;
    radius: number;
    speed: number;
    wobblePhase: number;
    wobbleSpeed: number;
    wobbleAmp: number;
    opacity: number;
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
const LIGHT_SHAFT_COUNT = 1;
const BUBBLE_COUNT = 12;
const CAUSTIC_GRID = 6; // NxN grid of caustic highlight nodes

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

function createLightShafts(canvasW: number): LightShaft[] {
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

function createCausticGrid(canvasW: number, canvasH: number): CausticNode[] {
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

function createBubbleCluster(canvasW: number, canvasH: number): Bubble[] {
    // Pick a random origin point for the cluster
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

function respawnBubble(b: Bubble, canvasW: number, canvasH: number) {
    // Respawn near the cluster's current x center
    const cx = rand(canvasW * 0.1, canvasW * 0.9);
    b.x = cx + rand(-25, 25);
    b.y = canvasH + rand(10, 40);
    b.radius = rand(2, 6);
    b.speed = rand(1.5, 3.0);
    b.opacity = rand(0.06, 0.14);
}

function drawLightShafts(ctx: CanvasRenderingContext2D, shafts: LightShaft[], canvasH: number, now: number) {
    ctx.save();
    for (const shaft of shafts) {
        shaft.swayPhase += shaft.swaySpeed;
        const sway = Math.sin(shaft.swayPhase) * shaft.swayAmp;
        const topX = shaft.x + sway;
        const halfTop = shaft.width / 2;
        const halfBottom = halfTop * shaft.spread;
        // Tilt: shift the bottom to the left like angled moonlight from upper-right
        const tilt = -canvasH * 0.18;

        const grad = ctx.createLinearGradient(topX, 0, topX + tilt * 0.5, canvasH * 0.9);
        const pulse = 0.85 + 0.15 * Math.sin(now * 0.0003 + shaft.swayPhase);
        const alpha = shaft.opacity * pulse;
        grad.addColorStop(0, `rgba(180, 225, 245, ${(alpha * 1.5).toFixed(4)})`);
        grad.addColorStop(0.15, `rgba(160, 215, 235, ${(alpha * 1.2).toFixed(4)})`);
        grad.addColorStop(0.4, `rgba(130, 200, 220, ${(alpha * 0.7).toFixed(4)})`);
        grad.addColorStop(0.7, `rgba(110, 190, 210, ${(alpha * 0.3).toFixed(4)})`);
        grad.addColorStop(1, 'rgba(100, 180, 200, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(topX - halfTop, 0);
        ctx.lineTo(topX + halfTop, 0);
        ctx.lineTo(topX + halfBottom + tilt, canvasH * 0.9);
        ctx.lineTo(topX - halfBottom + tilt, canvasH * 0.9);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

function drawCaustics(ctx: CanvasRenderingContext2D, nodes: CausticNode[]) {
    ctx.save();
    for (const node of nodes) {
        node.phase += node.speed;
        const pulse = 0.5 + 0.5 * Math.sin(node.phase);
        const alpha = 0.035 * pulse;
        // Larger radius with more gradient stops to fake blur
        const r = node.radius * (0.9 + 0.3 * pulse);

        const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r);
        grad.addColorStop(0, `rgba(160, 235, 245, ${alpha.toFixed(4)})`);
        grad.addColorStop(0.25, `rgba(140, 225, 235, ${(alpha * 0.7).toFixed(4)})`);
        grad.addColorStop(0.55, `rgba(120, 215, 225, ${(alpha * 0.3).toFixed(4)})`);
        grad.addColorStop(1, 'rgba(100, 200, 210, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawFishSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, direction: 1 | -1, opacity: number) {
    ctx.save();
    ctx.globalAlpha = Math.min(opacity * 2.5, 1);
    ctx.fillStyle = '#90dce8';
    ctx.shadowColor = '#34ffc4';
    ctx.shadowBlur = size * 6;
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
    ctx.translate(lev.x, lev.y);
    if (lev.direction === -1) ctx.scale(-1, 1);

    const w = lev.width;
    const h = lev.height;

    // Single soft radial gradient blob — no hard shapes
    const grad = ctx.createRadialGradient(0, 0, 0, w * 0.05, 0, w * 0.55);
    const a = lev.opacity;
    grad.addColorStop(0, `rgba(106, 184, 208, ${(a * 0.8).toFixed(4)})`);
    grad.addColorStop(0.4, `rgba(80, 160, 190, ${(a * 0.5).toFixed(4)})`);
    grad.addColorStop(0.7, `rgba(52, 255, 196, ${(a * 0.15).toFixed(4)})`);
    grad.addColorStop(1, 'rgba(52, 255, 196, 0)');

    ctx.fillStyle = grad;
    ctx.shadowColor = '#34ffc4';
    ctx.shadowBlur = w * 0.3;

    // Elongated ellipse — whale-like proportions, naturally soft from the gradient
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Subtle tail flare — a smaller, offset ellipse
    const tailGrad = ctx.createRadialGradient(-w * 0.45, 0, 0, -w * 0.45, 0, w * 0.18);
    tailGrad.addColorStop(0, `rgba(90, 170, 195, ${(a * 0.4).toFixed(4)})`);
    tailGrad.addColorStop(1, 'rgba(90, 170, 195, 0)');
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.ellipse(-w * 0.45, 0, w * 0.18, h * 0.4, 0, 0, Math.PI * 2);
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
    const lightShaftsRef = useRef<LightShaft[]>([]);
    const causticsRef = useRef<CausticNode[]>([]);
    const bubblesRef = useRef<Bubble[]>([]);
    const hiddenRef = useRef(false);

    const isUnderwater = resolved.id === 'underwater';

    // Immediately clear canvas when switching away from underwater
    useEffect(() => {
        if (!isUnderwater) {
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
            }
        }
    }, [isUnderwater]);

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

        // Initialize light shafts & caustics
        lightShaftsRef.current = createLightShafts(canvas.width);
        causticsRef.current = createCausticGrid(canvas.width, canvas.height);
        bubblesRef.current = createBubbleCluster(canvas.width, canvas.height);

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

            // --- Light shafts (behind everything) ---
            drawLightShafts(ctx, lightShaftsRef.current, canvas.height, now);

            // --- Caustic ripples ---
            drawCaustics(ctx, causticsRef.current);

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

            // --- Bubbles ---
            for (const b of bubblesRef.current) {
                b.wobblePhase += b.wobbleSpeed;
                b.y -= b.speed;
                b.x += Math.sin(b.wobblePhase) * b.wobbleAmp * 0.05;

                // Respawn at bottom when off top
                if (b.y < -b.radius * 2) {
                    respawnBubble(b, canvas.width, canvas.height);
                }

                ctx.save();
                ctx.globalAlpha = b.opacity;
                ctx.strokeStyle = '#80d4e8';
                ctx.lineWidth = 1;
                ctx.shadowColor = '#34ffc4';
                ctx.shadowBlur = b.radius * 2;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
                ctx.stroke();

                // Small highlight on upper-left
                ctx.globalAlpha = b.opacity * 0.6;
                ctx.fillStyle = '#b0ecf8';
                ctx.beginPath();
                ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.25, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
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
                    maxOpacity: rand(0.08, 0.14),
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
                    lev.opacity = Math.min(lev.opacity + 0.001, lev.maxOpacity);
                } else {
                    lev.opacity = Math.max(lev.opacity - 0.0006, 0);
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
            // Clear the canvas so no stale frame persists during unmount
            if (canvas) {
                const c = canvas.getContext('2d');
                if (c) c.clearRect(0, 0, canvas.width, canvas.height);
            }
        };
    }, [isUnderwater]);

    return (
        <canvas
            ref={canvasRef}
            className={`fixed inset-0 w-full h-full pointer-events-none z-0${isUnderwater ? '' : ' hidden'}`}
            aria-hidden="true"
        />
    );
}
