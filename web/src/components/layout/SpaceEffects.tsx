import { useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/theme-store';
import '../profile/integration-hub.css';

interface Star {
    x: number;
    y: number;
    size: number;
    speed: number;
    opacity: number;
    twinklePhase: number;
    twinkleSpeed: number;
    color: string;
}

interface ShootingStar {
    x: number;
    y: number;
    angle: number;
    speed: number;
    length: number;
    opacity: number;
    life: number;
    maxLife: number;
}

const STAR_COLORS = [
    'rgba(255, 255, 255, VAR)',     // white
    'rgba(200, 220, 255, VAR)',     // cool blue-white
    'rgba(180, 200, 255, VAR)',     // blue
    'rgba(200, 180, 255, VAR)',     // violet
    'rgba(160, 180, 255, VAR)',     // deeper blue
];

const STAR_COUNT = 60;
const SHOOTING_STAR_INTERVAL_MIN = 15000; // ms
const SHOOTING_STAR_INTERVAL_MAX = 35000; // ms

/**
 * Canvas-based ambient space effects for the Space dark theme (ROK-228).
 * Renders floating star particles with twinkle animation and occasional
 * shooting stars. Only active when the resolved theme is 'space'.
 * pointer-events: none so it never blocks interaction.
 */
function createStar(w: number, h: number): Star {
    return {
        x: Math.random() * w, y: Math.random() * h,
        size: Math.random() * 1.5 + 0.5, speed: Math.random() * 0.15 + 0.02,
        opacity: Math.random() * 0.6 + 0.3, twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    };
}

function nextShootingTime(now: number) {
    return now + SHOOTING_STAR_INTERVAL_MIN + Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);
}

function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], w: number, h: number) {
    for (const star of stars) {
        star.twinklePhase += star.twinkleSpeed;
        const alpha = star.opacity * (0.5 + 0.5 * Math.sin(star.twinklePhase));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = star.color.replace('VAR', alpha.toFixed(2));
        ctx.fill();
        star.y -= star.speed;
        if (star.y < -5) { star.y = h + 5; star.x = Math.random() * w; }
    }
}

function spawnShootingStar(shootingStars: ShootingStar[], w: number, h: number) {
    const angle = (Math.random() * 30 + 15) * (Math.PI / 180);
    shootingStars.push({
        x: Math.random() * w * 0.8, y: Math.random() * h * 0.3, angle,
        speed: Math.random() * 4 + 6, length: Math.random() * 60 + 40,
        opacity: 1, life: 0, maxLife: Math.random() * 40 + 30,
    });
}

function drawShootingStars(ctx: CanvasRenderingContext2D, shootingStars: ShootingStar[]) {
    for (let i = shootingStars.length - 1; i >= 0; i--) {
        const ss = shootingStars[i];
        ss.life++; ss.x += Math.cos(ss.angle) * ss.speed; ss.y += Math.sin(ss.angle) * ss.speed;
        ss.opacity = 1 - ss.life / ss.maxLife;
        if (ss.opacity <= 0) { shootingStars.splice(i, 1); continue; }
        const tailX = ss.x - Math.cos(ss.angle) * ss.length;
        const tailY = ss.y - Math.sin(ss.angle) * ss.length;
        const gradient = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(1, `rgba(255,255,255,${(ss.opacity * 0.8).toFixed(2)})`);
        ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(ss.x, ss.y);
        ctx.strokeStyle = gradient; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(ss.x, ss.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(ss.opacity * 0.9).toFixed(2)})`; ctx.fill();
    }
}

function animateSpace(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, starsRef: React.MutableRefObject<Star[]>, shootingStarsRef: React.MutableRefObject<ShootingStar[]>, nextShootingRef: React.MutableRefObject<number>) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStars(ctx, starsRef.current, canvas.width, canvas.height);
    if (performance.now() >= nextShootingRef.current) {
        spawnShootingStar(shootingStarsRef.current, canvas.width, canvas.height);
        nextShootingRef.current = nextShootingTime(performance.now());
    }
    drawShootingStars(ctx, shootingStarsRef.current);
}

function initSpaceWorld(canvas: HTMLCanvasElement, starsRef: React.MutableRefObject<Star[]>, nextShootingRef: React.MutableRefObject<number>) {
    starsRef.current = Array.from({ length: STAR_COUNT }, () => createStar(canvas.width, canvas.height));
    nextShootingRef.current = nextShootingTime(performance.now());
}

function useSpaceAnimation(isSpace: boolean, canvasRef: React.RefObject<HTMLCanvasElement | null>, starsRef: React.MutableRefObject<Star[]>, shootingStarsRef: React.MutableRefObject<ShootingStar[]>, nextShootingRef: React.MutableRefObject<number>, animRef: React.MutableRefObject<number>) {
    useEffect(() => {
        if (!isSpace && canvasRef.current) { canvasRef.current.width = 0; canvasRef.current.height = 0; }
    }, [isSpace, canvasRef]);

    useEffect(() => {
        if (!isSpace) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const resize = () => { if (canvas) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; } };
        resize(); window.addEventListener('resize', resize);
        initSpaceWorld(canvas, starsRef, nextShootingRef);
        const loop = () => { animateSpace(ctx, canvas, starsRef, shootingStarsRef, nextShootingRef); animRef.current = requestAnimationFrame(loop); };
        animRef.current = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(animRef.current); window.removeEventListener('resize', resize);
            if (canvas) { const c = canvas.getContext('2d'); if (c) c.clearRect(0, 0, canvas.width, canvas.height); }
        };
    }, [isSpace, canvasRef, starsRef, shootingStarsRef, nextShootingRef, animRef]);
}

export function SpaceEffects() {
    const resolved = useThemeStore((s) => s.resolved);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const starsRef = useRef<Star[]>([]);
    const shootingStarsRef = useRef<ShootingStar[]>([]);
    const nextShootingRef = useRef(0);
    const animRef = useRef(0);
    const isSpace = resolved.id === 'space';
    useSpaceAnimation(isSpace, canvasRef, starsRef, shootingStarsRef, nextShootingRef, animRef);

    return (
        <>
            {isSpace && <div className="profile-page__nebula" aria-hidden="true" />}
            {isSpace && <div className="profile-page__stars" aria-hidden="true" />}
            <canvas ref={canvasRef} className={`fixed inset-0 w-full h-full pointer-events-none z-0 opacity-60${isSpace ? '' : ' hidden'}`} aria-hidden="true" />
        </>
    );
}
