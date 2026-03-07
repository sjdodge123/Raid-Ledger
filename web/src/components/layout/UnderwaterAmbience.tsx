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
interface UnderwaterRefs {
    schools: React.MutableRefObject<FishSchool[]>;
    particles: React.MutableRefObject<Particle[]>;
    leviathan: React.MutableRefObject<Leviathan | null>;
    nextLeviathan: React.MutableRefObject<number>;
    lightShafts: React.MutableRefObject<LightShaft[]>;
    caustics: React.MutableRefObject<CausticNode[]>;
    bubbles: React.MutableRefObject<Bubble[]>;
    hidden: React.MutableRefObject<boolean>;
}

function initUnderwaterWorld(canvas: HTMLCanvasElement, refs: UnderwaterRefs) {
    refs.schools.current = Array.from({ length: SCHOOL_COUNT }, (_, i) => {
        const direction = Math.random() > 0.5 ? 1 : -1 as 1 | -1;
        return createSchool(canvas.width, canvas.height, i % 3, direction);
    });
    refs.particles.current = Array.from({ length: PARTICLE_COUNT }, () => createParticle(canvas.width, canvas.height));
    refs.lightShafts.current = createLightShafts(canvas.width);
    refs.caustics.current = createCausticGrid(canvas.width, canvas.height);
    refs.bubbles.current = createBubbleCluster(canvas.width, canvas.height);
    refs.nextLeviathan.current = performance.now() + rand(LEVIATHAN_MIN_INTERVAL, LEVIATHAN_MAX_INTERVAL);
}

function animateUnderwater(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, refs: UnderwaterRefs, now: number) {
    if (refs.hidden.current) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLightShafts(ctx, refs.lightShafts.current, canvas.height, now);
    drawCaustics(ctx, refs.caustics.current);
    drawParticles(ctx, refs.particles.current, canvas);
    drawBubbles(ctx, refs.bubbles.current, canvas);
    drawSchools(ctx, refs.schools.current, canvas);
    updateLeviathan(ctx, refs.leviathan, refs.nextLeviathan, canvas, now);
}

function useUnderwaterAnimation(isActive: boolean, canvasRef: React.RefObject<HTMLCanvasElement | null>, refs: UnderwaterRefs, animRef: React.MutableRefObject<number>) {
    useEffect(() => { if (!isActive && canvasRef.current) { canvasRef.current.width = 0; canvasRef.current.height = 0; } }, [isActive, canvasRef]);

    useEffect(() => {
        if (!isActive) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const resize = () => { if (canvas) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; } };
        resize(); window.addEventListener('resize', resize);
        const onVis = () => { refs.hidden.current = document.hidden; };
        document.addEventListener('visibilitychange', onVis);
        initUnderwaterWorld(canvas, refs);
        const loop = (now: number) => { animateUnderwater(ctx, canvas, refs, now); animRef.current = requestAnimationFrame(loop); };
        animRef.current = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(animRef.current); window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', onVis);
            if (canvas) { const c = canvas.getContext('2d'); if (c) c.clearRect(0, 0, canvas.width, canvas.height); }
        };
    }, [isActive, canvasRef, refs, animRef]);
}

export function UnderwaterAmbience() {
    const resolved = useThemeStore((s) => s.resolved);
    const prefersMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const refs: UnderwaterRefs = {
        schools: useRef<FishSchool[]>([]), particles: useRef<Particle[]>([]),
        leviathan: useRef<Leviathan | null>(null), nextLeviathan: useRef<number>(0),
        lightShafts: useRef<LightShaft[]>([]), caustics: useRef<CausticNode[]>([]),
        bubbles: useRef<Bubble[]>([]), hidden: useRef(false),
    };
    const isActive = resolved.id === 'underwater' && prefersMotion;
    useUnderwaterAnimation(isActive, canvasRef, refs, animRef);

    return <canvas ref={canvasRef} className={`fixed inset-0 w-full h-full pointer-events-none z-0${isActive ? '' : ' hidden'}`} aria-hidden="true" />;
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

function spawnLeviathan(canvas: HTMLCanvasElement): Leviathan {
    const direction = Math.random() > 0.5 ? 1 : -1 as 1 | -1;
    const width = rand(200, 400);
    return {
        x: direction === 1 ? -width : canvas.width + width,
        y: rand(canvas.height * 0.2, canvas.height * 0.8),
        width, height: width * rand(0.15, 0.25),
        speed: rand(0.8, 1.5), opacity: 0, direction,
        maxOpacity: rand(0.08, 0.14),
    };
}

function tickLeviathan(lev: Leviathan, canvasWidth: number) {
    lev.x += lev.speed * lev.direction;
    const distFromEdge = lev.direction === 1 ? lev.x + lev.width / 2 : canvasWidth - (lev.x - lev.width / 2);
    if (distFromEdge < canvasWidth * 0.3) lev.opacity = Math.min(lev.opacity + 0.001, lev.maxOpacity);
    else lev.opacity = Math.max(lev.opacity - 0.0006, 0);
}

function isLeviathanOffscreen(lev: Leviathan, canvasWidth: number) {
    return lev.direction === 1 ? lev.x - lev.width / 2 > canvasWidth + 50 : lev.x + lev.width / 2 < -50;
}

function updateLeviathan(
    ctx: CanvasRenderingContext2D,
    leviathanRef: React.MutableRefObject<Leviathan | null>,
    nextLeviathanRef: React.MutableRefObject<number>,
    canvas: HTMLCanvasElement,
    now: number,
) {
    if (!leviathanRef.current && now >= nextLeviathanRef.current) {
        leviathanRef.current = spawnLeviathan(canvas);
    }
    if (leviathanRef.current) {
        tickLeviathan(leviathanRef.current, canvas.width);
        drawLeviathan(ctx, leviathanRef.current);
        if (isLeviathanOffscreen(leviathanRef.current, canvas.width)) {
            leviathanRef.current = null;
            nextLeviathanRef.current = now + rand(LEVIATHAN_MIN_INTERVAL, LEVIATHAN_MAX_INTERVAL);
        }
    }
}
