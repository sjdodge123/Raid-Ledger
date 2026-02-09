import { useEffect, useRef } from 'react';

const ORBIT_DURATION = 90_000; // 90 seconds full revolution
const TILT_RAD = (15 * Math.PI) / 180; // 15° tilt
const COS_TILT = Math.cos(TILT_RAD);

// Easing constants
const DECEL_FACTOR = 0.96; // multiply velocity by this each frame when hovering
const ACCEL_FACTOR = 0.04; // approach 1.0 by this fraction each frame when not hovering
const VELOCITY_THRESHOLD = 0.01; // below this, clamp to 0

interface NodeCache {
    el: HTMLElement;
    angleRad: number;
    radius: number;
    isSpoke: boolean; // true = spoke-node, false = ghost-node
}

/**
 * Positions orbital nodes using trigonometric translation instead of
 * CSS rotate() transforms. Icons stay upright naturally because no
 * rotation is ever applied to the nodes themselves.
 *
 * Uses velocity-based easing for smooth hover pause/resume instead of
 * binary stop/start.
 */
export function useOrbitalAnimation(enabled = true) {
    const containerRef = useRef<HTMLDivElement>(null);
    const animFrameRef = useRef<number | undefined>(undefined);
    const isHoveredRef = useRef(false);
    const nodeCacheRef = useRef<NodeCache[] | null>(null);
    const currentAngleRef = useRef(0); // accumulated angle in radians
    const velocityRef = useRef(1.0); // speed multiplier 0.0–1.0
    const lastFrameRef = useRef(0); // timestamp of last frame

    useEffect(() => {
        if (!enabled || !containerRef.current) return;

        const container = containerRef.current;

        // Hover handlers — use ref to avoid effect re-runs
        const onEnter = () => {
            isHoveredRef.current = true;
        };
        const onLeave = () => {
            isHoveredRef.current = false;
        };
        container.addEventListener('mouseenter', onEnter);
        container.addEventListener('mouseleave', onLeave);

        // Build node cache once after mount
        const buildCache = (): NodeCache[] => {
            const nodes: NodeCache[] = [];
            const els = container.querySelectorAll('.spoke-node, .ghost-node');
            els.forEach((el) => {
                if (!(el instanceof HTMLElement)) return;
                const style = getComputedStyle(el);
                const angleDeg = parseFloat(style.getPropertyValue('--node-angle')) || 0;
                const radiusPx = parseFloat(style.getPropertyValue('--orbit-radius')) || 0;
                nodes.push({
                    el,
                    angleRad: (angleDeg * Math.PI) / 180,
                    radius: radiusPx,
                    isSpoke: el.classList.contains('spoke-node'),
                });
            });
            return nodes;
        };

        // Position a single node at a given orbital angle
        const positionNode = (node: NodeCache, orbitRad: number) => {
            const totalAngle = node.angleRad + orbitRad;
            const x = Math.cos(totalAngle) * node.radius;
            const y = Math.sin(totalAngle) * node.radius * COS_TILT; // compress Y for tilt
            node.el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;

            // Set --beam-angle for tractor beams (points toward center)
            const beamDeg = (Math.atan2(-y, -x) * 180) / Math.PI;
            node.el.style.setProperty('--beam-angle', `${beamDeg}deg`);

            // Point tooltip outward from center so it never overlaps the avatar
            const ax = Math.abs(x);
            const ay = Math.abs(y);
            if (ax > ay) {
                node.el.dataset.tooltipPos = x > 0 ? 'right' : 'left';
            } else {
                node.el.dataset.tooltipPos = y > 0 ? 'below' : 'above';
            }
        };

        // Compute initial positions synchronously to avoid flash
        const cache = buildCache();
        nodeCacheRef.current = cache;
        cache.forEach((n) => positionNode(n, 0));
        lastFrameRef.current = Date.now();

        const animate = () => {
            if (!containerRef.current || !nodeCacheRef.current) return;

            const now = Date.now();
            const dt = now - lastFrameRef.current;
            lastFrameRef.current = now;

            // Update velocity with easing
            if (isHoveredRef.current) {
                // Decelerate
                velocityRef.current *= DECEL_FACTOR;
                if (velocityRef.current < VELOCITY_THRESHOLD) {
                    velocityRef.current = 0;
                }
            } else if (velocityRef.current < 1.0) {
                // Accelerate back to full speed
                velocityRef.current += (1.0 - velocityRef.current) * ACCEL_FACTOR;
                if (velocityRef.current > 1.0 - VELOCITY_THRESHOLD) {
                    velocityRef.current = 1.0;
                }
            }

            // Accumulate angle based on current velocity
            const anglePerMs = (2 * Math.PI) / ORBIT_DURATION;
            currentAngleRef.current += anglePerMs * dt * velocityRef.current;

            for (const node of nodeCacheRef.current) {
                positionNode(node, currentAngleRef.current);
            }

            animFrameRef.current = requestAnimationFrame(animate);
        };

        animFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            container.removeEventListener('mouseenter', onEnter);
            container.removeEventListener('mouseleave', onLeave);
            nodeCacheRef.current = null;
        };
    }, [enabled]);

    return containerRef;
}
