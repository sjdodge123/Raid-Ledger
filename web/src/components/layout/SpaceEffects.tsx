import { useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/theme-store';

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
export function SpaceEffects() {
    const resolved = useThemeStore((s) => s.resolved);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const starsRef = useRef<Star[]>([]);
    const shootingStarsRef = useRef<ShootingStar[]>([]);
    const nextShootingRef = useRef<number>(0);

    const isSpace = resolved.id === 'space';

    useEffect(() => {
        if (!isSpace) return;
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

        // Initialize stars
        starsRef.current = Array.from({ length: STAR_COUNT }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 1.5 + 0.5,
            speed: Math.random() * 0.15 + 0.02,
            opacity: Math.random() * 0.6 + 0.3,
            twinklePhase: Math.random() * Math.PI * 2,
            twinkleSpeed: Math.random() * 0.02 + 0.005,
            color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        }));

        nextShootingRef.current = performance.now() +
            SHOOTING_STAR_INTERVAL_MIN +
            Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);

        function animate(now: number) {
            if (!canvas || !ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw & update stars
            for (const star of starsRef.current) {
                star.twinklePhase += star.twinkleSpeed;
                const twinkle = 0.5 + 0.5 * Math.sin(star.twinklePhase);
                const alpha = star.opacity * twinkle;
                const color = star.color.replace('VAR', alpha.toFixed(2));

                ctx.beginPath();
                ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();

                // Slow upward drift
                star.y -= star.speed;
                if (star.y < -5) {
                    star.y = canvas.height + 5;
                    star.x = Math.random() * canvas.width;
                }
            }

            // Spawn shooting star
            if (now >= nextShootingRef.current) {
                const angle = (Math.random() * 30 + 15) * (Math.PI / 180); // 15-45 degrees
                shootingStarsRef.current.push({
                    x: Math.random() * canvas.width * 0.8,
                    y: Math.random() * canvas.height * 0.3,
                    angle,
                    speed: Math.random() * 4 + 6,
                    length: Math.random() * 60 + 40,
                    opacity: 1,
                    life: 0,
                    maxLife: Math.random() * 40 + 30,
                });
                nextShootingRef.current = now +
                    SHOOTING_STAR_INTERVAL_MIN +
                    Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);
            }

            // Draw & update shooting stars
            shootingStarsRef.current = shootingStarsRef.current.filter((ss) => {
                ss.life++;
                ss.x += Math.cos(ss.angle) * ss.speed;
                ss.y += Math.sin(ss.angle) * ss.speed;
                ss.opacity = 1 - ss.life / ss.maxLife;

                if (ss.opacity <= 0) return false;

                const tailX = ss.x - Math.cos(ss.angle) * ss.length;
                const tailY = ss.y - Math.sin(ss.angle) * ss.length;

                const gradient = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y);
                gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
                gradient.addColorStop(1, `rgba(255, 255, 255, ${(ss.opacity * 0.8).toFixed(2)})`);

                ctx.beginPath();
                ctx.moveTo(tailX, tailY);
                ctx.lineTo(ss.x, ss.y);
                ctx.strokeStyle = gradient;
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Bright head
                ctx.beginPath();
                ctx.arc(ss.x, ss.y, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${(ss.opacity * 0.9).toFixed(2)})`;
                ctx.fill();

                return true;
            });

            animRef.current = requestAnimationFrame(animate);
        }

        animRef.current = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animRef.current);
            window.removeEventListener('resize', resize);
        };
    }, [isSpace]);

    if (!isSpace) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 w-full h-full pointer-events-none z-0 opacity-60"
            aria-hidden="true"
        />
    );
}
