import { useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/theme-store';
import { useMediaQuery } from '../../hooks/use-media-query';
import type { FishSchool, Particle, Leviathan, LightShaft, CausticNode, Bubble } from './underwater-ambience.types';
import { SCHOOL_COUNT, PARTICLE_COUNT, LEVIATHAN_MIN_INTERVAL, LEVIATHAN_MAX_INTERVAL } from './underwater-ambience.types';
import { rand, randInt, createSchool, createParticle, createLightShafts, createCausticGrid, createBubbleCluster, respawnBubble } from './underwater-ambience.helpers';
import { drawLightShafts, drawCaustics, drawFishSilhouette, drawLeviathan } from './underwater-ambience.effects';

/**
 * Canvas-based ambient underwater effects for the Deep Sea dark theme (ROK-296).
 * Renders schools of fish, occasional leviathan shadows, and floating particles.
 * Only active when the resolved theme is 'underwater'.
 * pointer-events: none so it never blocks interaction.
 */
export function UnderwaterAmbience() {
    const resolved = useThemeStore((s) => s.resolved);
    const prefersMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');
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
    const isActive = isUnderwater && prefersMotion;

    useEffect(() => {
        if (!isActive) {
            const canvas = canvasRef.current;
            if (canvas) { canvas.width = 0; canvas.height = 0; }
        }
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;
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

        function onVisibility() { hiddenRef.current = document.hidden; }
        document.addEventListener('visibilitychange', onVisibility);

        schoolsRef.current = Array.from({ length: SCHOOL_COUNT }, (_, i) => {
            const depth = i % 3;
            const direction = Math.random() > 0.5 ? 1 : -1 as 1 | -1;
            return createSchool(canvas.width, canvas.height, depth, direction);
        });
        particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => createParticle(canvas.width, canvas.height));
        lightShaftsRef.current = createLightShafts(canvas.width);
        causticsRef.current = createCausticGrid(canvas.width, canvas.height);
        bubblesRef.current = createBubbleCluster(canvas.width, canvas.height);
        nextLeviathanRef.current = performance.now() + rand(LEVIATHAN_MIN_INTERVAL, LEVIATHAN_MAX_INTERVAL);

        function animate(now: number) {
            if (!canvas || !ctx) return;
            if (hiddenRef.current) { animRef.current = requestAnimationFrame(animate); return; }
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            drawLightShafts(ctx, lightShaftsRef.current, canvas.height, now);
            drawCaustics(ctx, causticsRef.current);
            drawParticles(ctx, particlesRef.current, canvas);
            drawBubbles(ctx, bubblesRef.current, canvas);
            drawSchools(ctx, schoolsRef.current, canvas);
            updateLeviathan(ctx, leviathanRef, nextLeviathanRef, canvas, now);

            animRef.current = requestAnimationFrame(animate);
        }

        animRef.current = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animRef.current);
            window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', onVisibility);
            if (canvas) { const c = canvas.getContext('2d'); if (c) c.clearRect(0, 0, canvas.width, canvas.height); }
        };
    }, [isActive]);

    return (
        <canvas
            ref={canvasRef}
            className={`fixed inset-0 w-full h-full pointer-events-none z-0${isActive ? '' : ' hidden'}`}
            aria-hidden="true"
        />
    );
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], canvas: HTMLCanvasElement) {
    for (const p of particles) {
        p.driftPhase += p.driftSpeed;
        p.drift = Math.sin(p.driftPhase) * 1.5;
        p.y -= p.speed;
        p.x += p.drift * 0.1;
        if (p.y < -5) { p.y = canvas.height + 5; p.x = rand(0, canvas.width); }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 220, 240, ${p.opacity.toFixed(3)})`;
        ctx.fill();
    }
}

function drawBubbles(ctx: CanvasRenderingContext2D, bubbles: Bubble[], canvas: HTMLCanvasElement) {
    for (const b of bubbles) {
        b.wobblePhase += b.wobbleSpeed;
        b.y -= b.speed;
        b.x += Math.sin(b.wobblePhase) * b.wobbleAmp * 0.05;
        if (b.y < -b.radius * 2) { respawnBubble(b, canvas.width, canvas.height); }
        ctx.save();
        ctx.globalAlpha = b.opacity;
        ctx.strokeStyle = '#80d4e8';
        ctx.lineWidth = 1;
        ctx.shadowColor = '#34ffc4';
        ctx.shadowBlur = b.radius * 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = b.opacity * 0.6;
        ctx.fillStyle = '#b0ecf8';
        ctx.beginPath();
        ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawSchools(ctx: CanvasRenderingContext2D, schools: FishSchool[], canvas: HTMLCanvasElement) {
    for (let si = 0; si < schools.length; si++) {
        const school = schools[si];
        let allOffscreen = true;
        for (const fish of school.fish) {
            fish.wobblePhase += fish.wobbleSpeed;
            fish.x += fish.speed * school.direction;
            fish.y = fish.baseY + Math.sin(fish.wobblePhase) * fish.wobbleAmp;
            if (fish.x > -250 && fish.x < canvas.width + 250) allOffscreen = false;
            drawFishSilhouette(ctx, fish.x, fish.y, fish.size, school.direction, fish.opacity);
        }
        if (allOffscreen) {
            const depth = randInt(0, 2);
            const direction = Math.random() > 0.5 ? 1 : -1 as 1 | -1;
            schools[si] = createSchool(canvas.width, canvas.height, depth, direction);
        }
    }
}

function updateLeviathan(
    ctx: CanvasRenderingContext2D,
    leviathanRef: React.MutableRefObject<Leviathan | null>,
    nextLeviathanRef: React.MutableRefObject<number>,
    canvas: HTMLCanvasElement,
    now: number,
) {
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
        const distFromEdge = lev.direction === 1
            ? lev.x + lev.width / 2
            : canvas.width - (lev.x - lev.width / 2);
        if (distFromEdge < canvas.width * 0.3) {
            lev.opacity = Math.min(lev.opacity + 0.001, lev.maxOpacity);
        } else {
            lev.opacity = Math.max(lev.opacity - 0.0006, 0);
        }
        drawLeviathan(ctx, lev);
        const offscreen = lev.direction === 1
            ? lev.x - lev.width / 2 > canvas.width + 50
            : lev.x + lev.width / 2 < -50;
        if (offscreen) {
            leviathanRef.current = null;
            nextLeviathanRef.current = now + rand(LEVIATHAN_MIN_INTERVAL, LEVIATHAN_MAX_INTERVAL);
        }
    }
}
