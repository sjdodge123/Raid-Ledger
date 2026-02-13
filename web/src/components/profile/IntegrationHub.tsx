import { useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { User } from '../../hooks/use-auth';
import { buildDiscordAvatarUrl } from '../../lib/avatar';
import { API_BASE_URL } from '../../lib/config';
import { RoleBadge } from '../ui/role-badge';
import './integration-hub.css';

const AVATAR_PREF_KEY = 'raid-ledger:avatar-preference';

// Orbital animation constants
const ORBIT_DURATION = 120_000; // 120s full revolution (slow, ambient)
const TILT_RAD = (12 * Math.PI) / 180; // 12 deg tilt for subtle 3D
const COS_TILT = Math.cos(TILT_RAD);
const ORBIT_RADIUS = 100; // px — compact ring
const DECEL_FACTOR = 0.95;
const ACCEL_FACTOR = 0.05;
const VELOCITY_THRESHOLD = 0.01;

interface IntegrationHubProps {
    user: User;
    characters: { avatarUrl: string | null; name: string }[];
    onRefresh?: () => void;
}

/** Nav section configuration */
interface NavSection {
    id: string;
    label: string;
    basePath: string;
    icon: string; // SVG path
}

const NAV_SECTIONS: NavSection[] = [
    {
        id: 'identity',
        label: 'Identity',
        basePath: '/profile/identity',
        // User circle icon
        icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    },
    {
        id: 'preferences',
        label: 'Preferences',
        basePath: '/profile/preferences',
        // Sliders icon
        icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4',
    },
    {
        id: 'gaming',
        label: 'Gaming',
        basePath: '/profile/gaming',
        // Gamepad/play icon
        icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
];

/** Determine which section is active based on URL path */
function getActiveSection(pathname: string): string {
    for (const section of NAV_SECTIONS) {
        if (pathname.startsWith(section.basePath)) return section.id;
    }
    return 'identity';
}

/** Resolve avatar URL from user data */
function resolveAvatar(user: User, characters: { avatarUrl: string | null }[]): string {
    const stored = localStorage.getItem(AVATAR_PREF_KEY);
    const prefIndex = stored ? parseInt(stored, 10) : 0;

    const options: string[] = [];
    if (user.customAvatarUrl) {
        options.push(`${API_BASE_URL}${user.customAvatarUrl}`);
    }
    const hasDiscordLinked = user.discordId && !user.discordId.startsWith('local:');
    const discordUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    if (hasDiscordLinked && discordUrl) {
        options.push(discordUrl);
    }
    for (const char of characters) {
        if (char.avatarUrl) options.push(char.avatarUrl);
    }

    if (options.length > 0 && prefIndex >= 0 && prefIndex < options.length) {
        return options[prefIndex];
    }
    if (discordUrl) return discordUrl;
    return '/default-avatar.svg';
}

/**
 * Navigation Hub — compact orbital map of profile sections.
 * Replaces the old Integration Hub (ROK-195).
 * ROK-290: Orbiting nav sectionals (Identity, Preferences, Gaming)
 * that navigate to profile sub-sections when clicked.
 * No lightning arcs. Smaller and sticky.
 */
export function IntegrationHub({ user, characters }: IntegrationHubProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const activeSection = getActiveSection(location.pathname);
    const avatarUrl = resolveAvatar(user, characters);

    const containerRef = useRef<HTMLDivElement>(null);
    const animFrameRef = useRef<number | undefined>(undefined);
    const isHoveredRef = useRef(false);
    const currentAngleRef = useRef(0);
    const velocityRef = useRef(1.0);
    const lastFrameRef = useRef(0);

    const handleSectionClick = useCallback(
        (section: NavSection) => {
            navigate(section.basePath);
        },
        [navigate],
    );

    // Orbital animation — positions nav nodes around center avatar
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onEnter = () => { isHoveredRef.current = true; };
        const onLeave = () => { isHoveredRef.current = false; };
        container.addEventListener('mouseenter', onEnter);
        container.addEventListener('mouseleave', onLeave);

        const nodes = container.querySelectorAll<HTMLElement>('.nav-hub__node');
        if (nodes.length === 0) return;

        // Parse initial angles
        const nodeAngles = Array.from(nodes).map((el) => {
            const angleDeg = parseFloat(el.dataset.angle ?? '0');
            return (angleDeg * Math.PI) / 180;
        });

        const positionNodes = (orbitRad: number) => {
            nodes.forEach((el, i) => {
                const totalAngle = nodeAngles[i] + orbitRad;
                const x = Math.cos(totalAngle) * ORBIT_RADIUS;
                const y = Math.sin(totalAngle) * ORBIT_RADIUS * COS_TILT;
                el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
            });
        };

        // Initial position
        positionNodes(0);
        lastFrameRef.current = Date.now();

        const animate = () => {
            const now = Date.now();
            const dt = now - lastFrameRef.current;
            lastFrameRef.current = now;

            if (isHoveredRef.current) {
                velocityRef.current *= DECEL_FACTOR;
                if (velocityRef.current < VELOCITY_THRESHOLD) velocityRef.current = 0;
            } else if (velocityRef.current < 1.0) {
                velocityRef.current += (1.0 - velocityRef.current) * ACCEL_FACTOR;
                if (velocityRef.current > 1.0 - VELOCITY_THRESHOLD) velocityRef.current = 1.0;
            }

            const anglePerMs = (2 * Math.PI) / ORBIT_DURATION;
            currentAngleRef.current += anglePerMs * dt * velocityRef.current;
            positionNodes(currentAngleRef.current);

            animFrameRef.current = requestAnimationFrame(animate);
        };

        animFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            container.removeEventListener('mouseenter', onEnter);
            container.removeEventListener('mouseleave', onLeave);
        };
    }, []);

    // Evenly space 3 sections around the orbit
    const sectionAngles = NAV_SECTIONS.map((_, i) => (i * 360) / NAV_SECTIONS.length);

    return (
        <div className="nav-hub" ref={containerRef}>
            {/* Single orbit ring track */}
            <div className="nav-hub__ring" />

            {/* Center avatar */}
            <div className="nav-hub__center">
                <img
                    src={avatarUrl}
                    alt={user.username}
                    className="nav-hub__avatar"
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                />
                <div className="nav-hub__username">
                    {user.username}
                    <RoleBadge role={user.role} className="ml-1.5" />
                </div>
            </div>

            {/* Orbiting nav section nodes */}
            {NAV_SECTIONS.map((section, i) => {
                const isActive = activeSection === section.id;
                return (
                    <button
                        key={section.id}
                        type="button"
                        className={`nav-hub__node${isActive ? ' nav-hub__node--active' : ''}`}
                        data-angle={sectionAngles[i]}
                        onClick={() => handleSectionClick(section)}
                        aria-label={`Navigate to ${section.label}`}
                        title={section.label}
                    >
                        <div className="nav-hub__node-frame">
                            <svg
                                className="nav-hub__node-icon"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.75}
                                    d={section.icon}
                                />
                            </svg>
                        </div>
                        <span className="nav-hub__node-label">{section.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
