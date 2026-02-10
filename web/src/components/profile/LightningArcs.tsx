import { useEffect, useRef, useCallback } from 'react';
import './integration-hub.css';

// Element radii — conduits stop at the border, not the center
const POWER_CORE_RADIUS = 84;  // power-core__ring (80px) + glow margin
const SPOKE_RADIUS = 40;       // spoke-node__hex-frame (36px) + border
const GHOST_RADIUS = 40;       // ghost-node__icon-ring (36px) + border

/** Per-strand config for multi-path conduits */
interface StrandConfig {
    curvature: number;
    delay: number;      // animation-delay in seconds
    glowWidth: number;
    coreWidth: number;
    tangentOffset: number; // perpendicular offset on circle edge (px, + = right of line)
}

/** Emerald strands: center → Discord — 3 varied paths, staggered */
const EMERALD_STRANDS: StrandConfig[] = [
    { curvature: 0.03, delay: 0,   glowWidth: 14, coreWidth: 3,   tangentOffset: -12 },
    { curvature: 0.06, delay: 0.7, glowWidth: 10, coreWidth: 2,   tangentOffset: 0   },
    { curvature: 0.10, delay: 1.4, glowWidth: 12, coreWidth: 2.5, tangentOffset: 12  },
];

/** Purple strands: Discord → Ghost — 3 varied paths, offset from emerald */
const PURPLE_STRANDS: StrandConfig[] = [
    { curvature: -0.07, delay: 0.2, glowWidth: 12, coreWidth: 2.5, tangentOffset: -10 },
    { curvature: -0.10, delay: 0.9, glowWidth: 9,  coreWidth: 2,   tangentOffset: 0   },
    { curvature: -0.14, delay: 1.6, glowWidth: 11, coreWidth: 2,   tangentOffset: 10  },
];

/**
 * Generate a smooth quadratic bezier path between two points,
 * trimmed inward so it starts/ends at element borders rather than centers.
 * tangentOffset shifts the start/end points perpendicular to the connecting line
 * so strands fan out from tangent positions on the circle edges.
 */
function conduitPath(
    x1: number, y1: number,
    x2: number, y2: number,
    startInset: number,
    endInset: number,
    curvature = 0.1,
    tangentOffset = 0,
): string {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < startInset + endInset + 10) return '';

    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular unit vector (right-hand)
    const px = -uy;
    const py = ux;

    const sx = x1 + ux * startInset + px * tangentOffset;
    const sy = y1 + uy * startInset + py * tangentOffset;
    const ex = x2 - ux * endInset + px * tangentOffset;
    const ey = y2 - uy * endInset + py * tangentOffset;

    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const nx = -dy * curvature;
    const ny = dx * curvature;

    return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${(mx + nx).toFixed(1)},${(my + ny).toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

/** Set path `d` attribute and measure length for CSS --path-len variable */
function applyPath(el: SVGPathElement | null | undefined, d: string) {
    if (!el) return;
    el.setAttribute('d', d);
    const len = el.getTotalLength();
    el.style.setProperty('--path-len', `${len}`);
}

interface LightningArcsProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    hasActiveDiscord: boolean;
    hasActiveGhost: boolean;
    activatePulse?: boolean;
    onPulseComplete?: () => void;
}

/**
 * SVG overlay that draws pulsing energy conduits between the Power Core
 * and active integration spokes. Multiple strands per conduit with
 * slightly varied curvature create a bundle effect. Periodic short dashes
 * travel outward, synced to the 4s core-breathe animation cycle.
 */
export function LightningArcs({
    containerRef,
    hasActiveDiscord,
    hasActiveGhost,
    activatePulse,
    onPulseComplete,
}: LightningArcsProps) {
    const emeraldGroupRef = useRef<SVGGElement>(null);
    const purpleGroupRef = useRef<SVGGElement>(null);
    const burstEmeraldGroupRef = useRef<SVGGElement>(null);
    const burstPurpleGroupRef = useRef<SVGGElement>(null);
    const emeraldBeamRef = useRef<SVGPathElement>(null);
    const purpleBeamRef = useRef<SVGPathElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !hasActiveDiscord) return;

        const update = () => {
            const hr = container.getBoundingClientRect();
            const cx = hr.width / 2;
            const cy = hr.height / 2;

            const spoke = container.querySelector('.spoke-node--active');
            if (!spoke) return;

            const sr = spoke.getBoundingClientRect();
            const sx = sr.left + sr.width / 2 - hr.left;
            const sy = sr.top + sr.height / 2 - hr.top;

            // Update emerald multi-strand paths
            const emeraldPaths = emeraldGroupRef.current?.querySelectorAll('path');
            if (emeraldPaths) {
                EMERALD_STRANDS.forEach((strand, i) => {
                    const d = conduitPath(cx, cy, sx, sy, POWER_CORE_RADIUS, SPOKE_RADIUS, strand.curvature, strand.tangentOffset);
                    applyPath(emeraldPaths[i * 2] as SVGPathElement, d);     // glow
                    applyPath(emeraldPaths[i * 2 + 1] as SVGPathElement, d); // core
                });
            }

            // Beam baseline — center strand curvature
            applyPath(emeraldBeamRef.current, conduitPath(cx, cy, sx, sy, POWER_CORE_RADIUS, SPOKE_RADIUS, EMERALD_STRANDS[1].curvature));

            // Burst uses center strand's curvature
            const burstEPaths = burstEmeraldGroupRef.current?.querySelectorAll('path');
            if (burstEPaths) {
                const d = conduitPath(cx, cy, sx, sy, POWER_CORE_RADIUS, SPOKE_RADIUS, EMERALD_STRANDS[1].curvature);
                burstEPaths.forEach(p => applyPath(p as SVGPathElement, d));
            }

            // Purple multi-strand paths
            if (hasActiveGhost) {
                const ghost = container.querySelector('.ghost-node--active');
                if (ghost && purpleGroupRef.current) {
                    const gr = ghost.getBoundingClientRect();
                    const gx = gr.left + gr.width / 2 - hr.left;
                    const gy = gr.top + gr.height / 2 - hr.top;

                    const purplePaths = purpleGroupRef.current.querySelectorAll('path');
                    PURPLE_STRANDS.forEach((strand, i) => {
                        const d = conduitPath(sx, sy, gx, gy, SPOKE_RADIUS, GHOST_RADIUS, strand.curvature, strand.tangentOffset);
                        applyPath(purplePaths[i * 2] as SVGPathElement, d);
                        applyPath(purplePaths[i * 2 + 1] as SVGPathElement, d);
                    });
                    purpleGroupRef.current.style.display = '';

                    const burstPPaths = burstPurpleGroupRef.current?.querySelectorAll('path');
                    if (burstPPaths) {
                        const d = conduitPath(sx, sy, gx, gy, SPOKE_RADIUS, GHOST_RADIUS, PURPLE_STRANDS[1].curvature);
                        burstPPaths.forEach(p => applyPath(p as SVGPathElement, d));
                    }
                    if (burstPurpleGroupRef.current) burstPurpleGroupRef.current.style.display = '';

                    // Purple beam baseline
                    applyPath(purpleBeamRef.current, conduitPath(sx, sy, gx, gy, SPOKE_RADIUS, GHOST_RADIUS, PURPLE_STRANDS[1].curvature));
                    if (purpleBeamRef.current) purpleBeamRef.current.style.display = '';
                } else {
                    if (purpleGroupRef.current) purpleGroupRef.current.style.display = 'none';
                    if (burstPurpleGroupRef.current) burstPurpleGroupRef.current.style.display = 'none';
                    if (purpleBeamRef.current) purpleBeamRef.current.style.display = 'none';
                }
            }
        };

        const id = setInterval(update, 50);
        update();
        return () => clearInterval(id);
    }, [containerRef, hasActiveDiscord, hasActiveGhost]);

    const handleBurstEnd = useCallback(() => {
        onPulseComplete?.();
    }, [onPulseComplete]);

    if (!hasActiveDiscord) return null;

    return (
        <svg className="lightning-arcs" aria-hidden="true">
            {/* ── Laser beam baselines — persistent pulsating guide lines ── */}
            <path ref={emeraldBeamRef} className="beam-line beam-line--emerald" strokeWidth="2" />
            <path ref={purpleBeamRef} className="beam-line beam-line--purple" strokeWidth="2"
                  style={{ display: hasActiveGhost ? undefined : 'none' }} />

            {/* ── Emerald multi-strand conduit: Center → Discord ── */}
            <g ref={emeraldGroupRef}>
                {EMERALD_STRANDS.map((strand, i) => (
                    <g key={`e-${i}`}>
                        <path
                            className="pulse-line__glow pulse-line__glow--emerald"
                            fill="none"
                            strokeWidth={strand.glowWidth}
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                        <path
                            className="pulse-line__core pulse-line__core--emerald"
                            fill="none"
                            strokeWidth={strand.coreWidth}
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                    </g>
                ))}
            </g>

            {/* ── Purple multi-strand conduit: Discord → Ghost ── */}
            <g ref={purpleGroupRef} style={{ display: hasActiveGhost ? undefined : 'none' }}>
                {PURPLE_STRANDS.map((strand, i) => (
                    <g key={`p-${i}`}>
                        <path
                            className="pulse-line__glow pulse-line__glow--purple"
                            fill="none"
                            strokeWidth={strand.glowWidth}
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                        <path
                            className="pulse-line__core pulse-line__core--purple"
                            fill="none"
                            strokeWidth={strand.coreWidth}
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                    </g>
                ))}
            </g>

            {/* ── Activation burst (single bright strand per conduit) ── */}
            {activatePulse && (
                <>
                    <g ref={burstEmeraldGroupRef}>
                        <path
                            className="burst-line__glow burst-line__glow--emerald"
                            fill="none"
                            strokeWidth="22"
                            strokeLinecap="round"
                            onAnimationEnd={handleBurstEnd}
                        />
                        <path
                            className="burst-line__core burst-line__core--emerald"
                            fill="none"
                            strokeWidth="5"
                            strokeLinecap="round"
                        />
                    </g>
                    <g ref={burstPurpleGroupRef} style={{ display: hasActiveGhost ? undefined : 'none' }}>
                        <path
                            className="burst-line__glow burst-line__glow--purple"
                            fill="none"
                            strokeWidth="18"
                            strokeLinecap="round"
                        />
                        <path
                            className="burst-line__core burst-line__core--purple"
                            fill="none"
                            strokeWidth="4"
                            strokeLinecap="round"
                        />
                    </g>
                </>
            )}
        </svg>
    );
}

// ─── Mobile Pulse Conduits ─────────────────────────────────────────────────

/** Emerald strands: avatar → Discord icon */
const MOBILE_EMERALD_STRANDS = [
    { offsetX: -10, delay: 0   },
    { offsetX:  -4, delay: 1.3 },
    { offsetX: -17, delay: 2.6 },
];

/** Purple strands: Discord icon → Notifications icon */
const MOBILE_PURPLE_STRANDS = [
    { offsetX: -8,  delay: 0.3 },
    { offsetX: -15, delay: 1.6 },
    { offsetX: -3,  delay: 2.9 },
];

interface MobilePulseConduitsProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    hasActiveDiscord: boolean;
    hasActiveGhost: boolean;
}

/**
 * SVG overlay for mobile layout — draws vertical pulse conduits
 * originating from the avatar, through Discord, down to Notifications.
 * Emerald strands run avatar→Discord, purple strands run Discord→Notifications.
 * Container ref must wrap both the avatar section and the module list.
 */
export function MobilePulseConduits({
    containerRef,
    hasActiveDiscord,
    hasActiveGhost,
}: MobilePulseConduitsProps) {
    const emeraldGroupRef = useRef<SVGGElement>(null);
    const purpleGroupRef = useRef<SVGGElement>(null);
    const mobileEmeraldBeamRef = useRef<SVGPathElement>(null);
    const mobilePurpleBeamRef = useRef<SVGPathElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !hasActiveDiscord) return;

        const update = () => {
            const containerRect = container.getBoundingClientRect();

            // Avatar circle — pulse origin
            const avatar = container.querySelector('.mobile-avatar');
            if (!avatar) return;
            const ar = avatar.getBoundingClientRect();
            const avatarCx = ar.left + ar.width / 2 - containerRect.left;
            const avatarBottom = ar.bottom - containerRect.top;

            // Module rows (reordered: Discord=0, Notifications=1, ...)
            const rows = container.querySelectorAll('.mobile-module-row');
            if (rows.length < 2) return;

            const discordIcon = rows[0].querySelector('.mobile-module-row__icon');
            if (!discordIcon) return;
            const di = discordIcon.getBoundingClientRect();
            const diCx = di.left + di.width / 2 - containerRect.left;
            const diCy = di.top + di.height / 2 - containerRect.top;
            const iconR = 20; // 40px / 2

            // ── Emerald strands: avatar bottom → Discord icon top ──
            const emeraldPaths = emeraldGroupRef.current?.querySelectorAll('path');
            if (emeraldPaths) {
                const startY = avatarBottom;
                const endY = diCy - iconR;
                const spanY = endY - startY;

                MOBILE_EMERALD_STRANDS.forEach((strand, i) => {
                    const cp1x = avatarCx + strand.offsetX;
                    const cp1y = startY + spanY * 0.35;
                    const cp2x = diCx + strand.offsetX;
                    const cp2y = startY + spanY * 0.65;
                    const d = `M${avatarCx.toFixed(1)},${startY.toFixed(1)} C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${diCx.toFixed(1)},${endY.toFixed(1)}`;
                    applyPath(emeraldPaths[i * 2] as SVGPathElement, d);
                    applyPath(emeraldPaths[i * 2 + 1] as SVGPathElement, d);
                });
            }

            // Emerald beam baseline (center strand path)
            {
                const startY = avatarBottom;
                const endY = diCy - iconR;
                const spanY = endY - startY;
                const s = MOBILE_EMERALD_STRANDS[1];
                const cp1x = avatarCx + s.offsetX;
                const cp1y = startY + spanY * 0.35;
                const cp2x = diCx + s.offsetX;
                const cp2y = startY + spanY * 0.65;
                const d = `M${avatarCx.toFixed(1)},${startY.toFixed(1)} C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${diCx.toFixed(1)},${endY.toFixed(1)}`;
                applyPath(mobileEmeraldBeamRef.current, d);
            }

            // ── Purple strands: Discord icon bottom → Notifications icon top ──
            if (hasActiveGhost && purpleGroupRef.current) {
                const notifIcon = rows[1]?.querySelector('.mobile-module-row__icon');
                if (notifIcon) {
                    const ni = notifIcon.getBoundingClientRect();
                    const niCx = ni.left + ni.width / 2 - containerRect.left;
                    const niCy = ni.top + ni.height / 2 - containerRect.top;

                    const startY = diCy + iconR;
                    const endY = niCy - iconR;
                    const spanY = endY - startY;

                    const purplePaths = purpleGroupRef.current.querySelectorAll('path');
                    MOBILE_PURPLE_STRANDS.forEach((strand, i) => {
                        const cp1x = diCx + strand.offsetX;
                        const cp1y = startY + spanY * 0.35;
                        const cp2x = niCx + strand.offsetX;
                        const cp2y = startY + spanY * 0.65;
                        const d = `M${diCx.toFixed(1)},${startY.toFixed(1)} C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${niCx.toFixed(1)},${endY.toFixed(1)}`;
                        applyPath(purplePaths[i * 2] as SVGPathElement, d);
                        applyPath(purplePaths[i * 2 + 1] as SVGPathElement, d);
                    });
                    purpleGroupRef.current.style.display = '';

                    // Purple beam baseline (center strand path)
                    const ps = MOBILE_PURPLE_STRANDS[1];
                    const pcp1x = diCx + ps.offsetX;
                    const pcp1y = startY + spanY * 0.35;
                    const pcp2x = niCx + ps.offsetX;
                    const pcp2y = startY + spanY * 0.65;
                    const beamD = `M${diCx.toFixed(1)},${startY.toFixed(1)} C${pcp1x.toFixed(1)},${pcp1y.toFixed(1)} ${pcp2x.toFixed(1)},${pcp2y.toFixed(1)} ${niCx.toFixed(1)},${endY.toFixed(1)}`;
                    applyPath(mobilePurpleBeamRef.current, beamD);
                    if (mobilePurpleBeamRef.current) mobilePurpleBeamRef.current.style.display = '';
                } else {
                    purpleGroupRef.current.style.display = 'none';
                    if (mobilePurpleBeamRef.current) mobilePurpleBeamRef.current.style.display = 'none';
                }
            }
        };

        update();
        const observer = new ResizeObserver(update);
        observer.observe(container);
        return () => observer.disconnect();
    }, [containerRef, hasActiveDiscord, hasActiveGhost]);

    if (!hasActiveDiscord) return null;

    return (
        <svg className="mobile-pulse-conduits" aria-hidden="true">
            {/* Laser beam baselines */}
            <path ref={mobileEmeraldBeamRef} className="beam-line beam-line--emerald" strokeWidth="1.5" />
            <path ref={mobilePurpleBeamRef} className="beam-line beam-line--purple" strokeWidth="1.5"
                  style={{ display: hasActiveGhost ? undefined : 'none' }} />

            {/* Emerald: avatar → Discord */}
            <g ref={emeraldGroupRef}>
                {MOBILE_EMERALD_STRANDS.map((strand, i) => (
                    <g key={`me-${i}`}>
                        <path
                            className="pulse-line__glow pulse-line__glow--emerald"
                            fill="none"
                            strokeWidth="8"
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                        <path
                            className="pulse-line__core pulse-line__core--emerald"
                            fill="none"
                            strokeWidth="2"
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                    </g>
                ))}
            </g>

            {/* Purple: Discord → Notifications */}
            <g ref={purpleGroupRef} style={{ display: hasActiveGhost ? undefined : 'none' }}>
                {MOBILE_PURPLE_STRANDS.map((strand, i) => (
                    <g key={`mp-${i}`}>
                        <path
                            className="pulse-line__glow pulse-line__glow--purple"
                            fill="none"
                            strokeWidth="8"
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                        <path
                            className="pulse-line__core pulse-line__core--purple"
                            fill="none"
                            strokeWidth="2"
                            strokeLinecap="round"
                            style={{ animationDelay: `${strand.delay}s` }}
                        />
                    </g>
                ))}
            </g>
        </svg>
    );
}
