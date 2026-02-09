import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { User } from '../../hooks/use-auth';
import type { CharacterDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../../lib/config';
import { PowerCoreAvatar } from './PowerCoreAvatar';
import { IntegrationSpoke, type SpokeStatus } from './IntegrationSpoke';
import { OrbitRing } from './OrbitRing';
import { GhostNode } from './GhostNode';
import { AvatarSelectorModal } from './AvatarSelectorModal';
import { DiscordDetailsModal } from './DiscordDetailsModal';
import { useOrbitalAnimation } from './use-orbital-animation';
import { LightningArcs, MobilePulseConduits } from './LightningArcs';
import './integration-hub.css';

const AVATAR_PREF_KEY = 'raid-ledger:avatar-preference';
const MOBILE_BREAKPOINT = 640;

interface IntegrationHubProps {
    user: User;
    characters: CharacterDto[];
    onRefresh?: () => void;
}

/** Reactive mobile breakpoint check */
function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
    const [mobile, setMobile] = useState(() =>
        typeof window !== 'undefined' && window.innerWidth <= breakpoint,
    );
    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
        setMobile(mq.matches);
        const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [breakpoint]);
    return mobile;
}

/** Build the list of avatar options from user data and characters */
function buildAvatarOptions(user: User, characters: CharacterDto[]) {
    const options: { url: string; label: string }[] = [];

    // Discord avatar
    const hasDiscordLinked = user.discordId && !user.discordId.startsWith('local:');
    if (hasDiscordLinked && user.avatar) {
        options.push({
            url: `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=128`,
            label: 'Discord',
        });
    }

    // Character portraits
    for (const char of characters) {
        if (char.avatarUrl) {
            options.push({
                url: char.avatarUrl,
                label: char.name,
            });
        }
    }

    return options;
}

/** Get the current avatar URL based on preference index */
function resolveCurrentAvatar(
    options: { url: string; label: string }[],
    prefIndex: number,
    user: User,
): string {
    if (options.length > 0 && prefIndex >= 0 && prefIndex < options.length) {
        return options[prefIndex].url;
    }
    // Fallback: Discord avatar or default
    const hasDiscord = user.discordId && !user.discordId.startsWith('local:');
    if (hasDiscord && user.avatar) {
        return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=128`;
    }
    return '/default-avatar.svg';
}

/* ─── Platform icon SVG paths (shared between mobile & desktop) ─── */
const DISCORD_ICON_PATH = 'M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';
const BATTLENET_ICON_PATH = 'M10.457 0c-.17.002-.34.018-.508.048C6.073.91 4.534 5.092 4.534 5.092s-.372-.273-.874-.467c0 0-1.235 3.08.02 6.141-1.467.527-3.126 1.545-3.496 3.093-.757 3.168 3.359 4.983 3.359 4.983s-.06.274-.026.674c0 0 3.104.787 6.065-.926.37 1.516 1.335 3.23 2.862 3.73 3.122 1.022 5.786-2.697 5.786-2.697s.268.087.633.106c0 0 1.095-2.963-.456-5.914 1.425-.607 2.988-1.726 3.178-3.303.387-3.228-4.063-4.423-4.063-4.423s.029-.277-.029-.67c0 0-2.39-.487-4.906.69 0 0-.148-.079-.362-.163C12.09.913 11.182-.008 10.457 0z';
const STEAM_ICON_PATH = 'M11.979 0C5.678 0 .511 4.86.022 10.94l6.432 2.658a3.387 3.387 0 0 1 1.912-.59c.064 0 .127.003.19.007l2.862-4.145V8.82c0-2.578 2.098-4.675 4.676-4.675s4.676 2.097 4.676 4.675-2.098 4.676-4.676 4.676h-.109l-4.078 2.91c0 .049.003.097.003.146 0 1.934-1.573 3.507-3.507 3.507-1.704 0-3.126-1.222-3.438-2.838L.254 15.29C1.512 20.223 6.31 24 11.979 24c6.627 0 12.001-5.373 12.001-12S18.606 0 11.979 0z';

/** Compact module row for mobile layout */
function MobileModuleRow({
    icon,
    name,
    ring,
    status,
    statusLabel,
    onAction,
    actionLabel,
    accentClass,
}: {
    icon: React.ReactNode;
    name: string;
    ring: string;
    status: 'active' | 'dormant' | 'placeholder';
    statusLabel: string;
    onAction?: () => void;
    actionLabel?: string;
    accentClass: string;
}) {
    return (
        <button
            type="button"
            className={`mobile-module-row mobile-module-row--${status}`}
            onClick={onAction}
            disabled={status === 'placeholder'}
        >
            <div className={`mobile-module-row__icon ${accentClass}`}>
                {icon}
            </div>
            <div className="mobile-module-row__info">
                <span className="mobile-module-row__name">{name}</span>
                <span className="mobile-module-row__ring">{ring}</span>
            </div>
            <div className="mobile-module-row__status">
                {status === 'active' && (
                    <span className="mobile-module-row__badge mobile-module-row__badge--active">
                        Linked
                    </span>
                )}
                {status === 'dormant' && actionLabel && (
                    <span className="mobile-module-row__badge mobile-module-row__badge--dormant">
                        {actionLabel}
                    </span>
                )}
                {status === 'placeholder' && (
                    <span className="mobile-module-row__badge mobile-module-row__badge--placeholder">
                        {statusLabel}
                    </span>
                )}
            </div>
        </button>
    );
}

/**
 * Hub & Spoke Integration Widget (ROK-195)
 * Desktop: 3 concentric orbital rings with power conduits
 * Mobile: Compact vertical list of module cards
 */
export function IntegrationHub({ user, characters, onRefresh }: IntegrationHubProps) {
    const isMobile = useIsMobile();
    const [searchParams, setSearchParams] = useSearchParams();
    const [showAvatarModal, setShowAvatarModal] = useState(false);
    const [showDiscordModal, setShowDiscordModal] = useState(false);
    const [activatePulse, setActivatePulse] = useState(false);

    // Avatar preference from localStorage
    const [avatarIndex, setAvatarIndex] = useState(() => {
        const stored = localStorage.getItem(AVATAR_PREF_KEY);
        return stored ? parseInt(stored, 10) : 0;
    });

    // Check for Discord link result on mount
    useEffect(() => {
        const linked = searchParams.get('linked');
        const message = searchParams.get('message');

        if (linked === 'success') {
            toast.success('Discord account linked successfully!');
            setActivatePulse(true);
            setSearchParams({});
            onRefresh?.();
        } else if (linked === 'error') {
            toast.error(message || 'Failed to link Discord account');
            setSearchParams({});
        }
    }, [searchParams, setSearchParams, onRefresh]);

    // Derive platform statuses
    const hasDiscordLinked = Boolean(user.discordId && !user.discordId.startsWith('local:'));
    const discordStatus: SpokeStatus = hasDiscordLinked ? 'active' : 'dormant';

    // AC-5: Sympathetic glow — hovering primary Discord pulses the ghost node
    const [discordHovered, setDiscordHovered] = useState(false);

    // Build avatar options
    const avatarOptions = buildAvatarOptions(user, characters);
    const currentAvatarUrl = resolveCurrentAvatar(avatarOptions, avatarIndex, user);

    // Avatar cycling (wraps around in both directions)
    const cycleAvatar = useCallback((direction: 1 | -1) => {
        if (avatarOptions.length === 0) return;
        const len = avatarOptions.length;
        const newIndex = ((avatarIndex + direction) % len + len) % len;
        setAvatarIndex(newIndex);
        localStorage.setItem(AVATAR_PREF_KEY, String(newIndex));
    }, [avatarIndex, avatarOptions.length]);

    const handleAvatarSelect = useCallback((url: string) => {
        const idx = avatarOptions.findIndex(o => o.url === url);
        if (idx >= 0) {
            setAvatarIndex(idx);
            localStorage.setItem(AVATAR_PREF_KEY, String(idx));
        }
    }, [avatarOptions]);

    // Discord link handler
    // Note: Token in URL is required because browser redirects cannot send Authorization headers.
    // The backend validates and consumes this immediately, mitigating the exposure window.
    // TODO: Replace with a short-lived CSRF state token for production hardening.
    const handleLinkDiscord = () => {
        const token = localStorage.getItem('raid_ledger_token');
        if (!token) {
            toast.error('Please log in again to link Discord');
            return;
        }
        window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;
    };

    // Refs
    const mobileListRef = useRef<HTMLDivElement>(null);
    // Orbital animation — disabled on mobile
    const orbitRef = useOrbitalAnimation(!isMobile);

    // Shared icon helper
    const platformIcon = (path: string, className = '') => (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d={path} />
        </svg>
    );

    // ── Mobile layout ──────────────────────────────────────────────
    if (isMobile) {
        return (
            <div>
                {/* Section header */}
                <div className="px-4 pt-4 pb-0">
                    <h2 className="text-lg font-semibold text-white">Integration Modules</h2>
                    <p className="text-slate-400 text-xs mt-1">
                        Link platforms to sync auth, gaming data, and notifications
                    </p>
                </div>

                {/* Avatar + module list — single container for pulse conduit SVG */}
                <div className="mobile-hub-content" ref={mobileListRef}>
                    {/* Pulse conduits: avatar → Discord → Notifications */}
                    <MobilePulseConduits
                        containerRef={mobileListRef}
                        hasActiveDiscord={hasDiscordLinked}
                        hasActiveGhost={hasDiscordLinked}
                    />

                    {/* Compact avatar */}
                    <div className="flex flex-col items-center py-5">
                        <div className="mobile-avatar">
                            <img
                                src={currentAvatarUrl}
                                alt={user.username}
                                className="mobile-avatar__img"
                                onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                            />
                            <button
                                className="mobile-avatar__edit"
                                onClick={() => setShowAvatarModal(true)}
                                aria-label="Change avatar"
                            >
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                            </button>
                        </div>
                        <div className="mt-2 text-center">
                            <span className="text-base font-bold text-white">{user.username}</span>
                            {user.isAdmin && (
                                <span className="ml-2 inline-block px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
                                    Admin
                                </span>
                            )}
                        </div>
                        {avatarOptions.length > 1 && (
                            <div className="flex items-center gap-3 mt-2">
                                <button
                                    className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-sm flex items-center justify-center"
                                    onClick={() => cycleAvatar(-1)}
                                    aria-label="Previous avatar"
                                >
                                    ‹
                                </button>
                                <span className="text-xs text-slate-500">Change Avatar</span>
                                <button
                                    className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-sm flex items-center justify-center"
                                    onClick={() => cycleAvatar(1)}
                                    aria-label="Next avatar"
                                >
                                    ›
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Module list — connected services first */}
                    <div className="mobile-module-list">
                        {/* AUTH */}
                        <MobileModuleRow
                            icon={platformIcon(DISCORD_ICON_PATH, 'w-5 h-5')}
                            name="Discord"
                            ring="AUTH"
                            status={discordStatus}
                            statusLabel=""
                            accentClass="mobile-module-row__icon--emerald"
                            onAction={hasDiscordLinked
                                ? () => setShowDiscordModal(true)
                                : handleLinkDiscord}
                            actionLabel={hasDiscordLinked ? undefined : 'Link'}
                        />

                        {/* COMMS — adjacent to Discord so pulse line doesn't cross placeholders */}
                        <MobileModuleRow
                            icon={platformIcon(DISCORD_ICON_PATH, 'w-5 h-5')}
                            name="Notifications"
                            ring="COMMS"
                            status={hasDiscordLinked ? 'active' : 'placeholder'}
                            statusLabel={hasDiscordLinked ? '' : 'Requires Discord'}
                            accentClass="mobile-module-row__icon--purple"
                        />

                        {/* GAMING — placeholders below connected services */}
                        <MobileModuleRow
                            icon={platformIcon(BATTLENET_ICON_PATH, 'w-5 h-5')}
                            name="Battle.net"
                            ring="GAMING"
                            status="placeholder"
                            statusLabel="Coming Soon"
                            accentClass="mobile-module-row__icon--teal"
                        />
                        <MobileModuleRow
                            icon={platformIcon(STEAM_ICON_PATH, 'w-5 h-5')}
                            name="Steam"
                            ring="GAMING"
                            status="placeholder"
                            statusLabel="Coming Soon"
                            accentClass="mobile-module-row__icon--teal"
                        />
                    </div>
                </div>

                {/* Avatar Selector Modal */}
                <AvatarSelectorModal
                    isOpen={showAvatarModal}
                    onClose={() => setShowAvatarModal(false)}
                    currentAvatarUrl={currentAvatarUrl}
                    avatarOptions={avatarOptions}
                    onSelect={handleAvatarSelect}
                />

                {/* Discord Details Modal */}
                <DiscordDetailsModal
                    isOpen={showDiscordModal}
                    onClose={() => setShowDiscordModal(false)}
                    username={user.username}
                    discordId={user.discordId || ''}
                    avatar={user.avatar || null}
                    onRefresh={onRefresh}
                />
            </div>
        );
    }

    // ── Desktop orbital layout ─────────────────────────────────────
    return (
        <div>
            {/* Section header */}
            <div className="px-6 pt-5 pb-0">
                <h2 className="text-xl font-semibold text-white">Integration Modules</h2>
                <p className="text-slate-400 text-sm mt-1">
                    Link your platforms to sync authentication, gaming data, and notifications
                </p>
            </div>
            <div className="integration-hub" ref={orbitRef}>
                {/* Nebula + star particle background */}
                <div className="integration-hub__nebula" />
                <div className="integration-hub__stars" />

                {/* Power conduits between active modules */}
                <LightningArcs
                    containerRef={orbitRef}
                    hasActiveDiscord={hasDiscordLinked}
                    hasActiveGhost={hasDiscordLinked}
                    activatePulse={activatePulse}
                    onPulseComplete={() => setActivatePulse(false)}
                />

                {/* Center Hub — Power Core Avatar */}
                <PowerCoreAvatar
                    avatarUrl={currentAvatarUrl}
                    username={user.username}
                    isAdmin={user.isAdmin}
                    onEdit={() => setShowAvatarModal(true)}
                    onCyclePrev={() => cycleAvatar(-1)}
                    onCycleNext={() => cycleAvatar(1)}
                    hasMultipleAvatars={avatarOptions.length > 1}
                />

                {/* AUTH Ring (Inner) */}
                <OrbitRing label="AUTH" radius={160} ringIndex={0}>
                    <IntegrationSpoke
                        platform="discord"
                        status={discordStatus}
                        label="Discord"
                        statusText=""
                        tooltipText={hasDiscordLinked
                            ? 'Discord — Authentication linked'
                            : 'Click to link Discord for authentication'}
                        angle={0}
                        onLink={handleLinkDiscord}
                        onViewDetails={() => setShowDiscordModal(true)}
                        onHoverChange={setDiscordHovered}
                    />
                </OrbitRing>

                {/* GAMING Ring (Middle) */}
                <OrbitRing label="GAMING" radius={220} ringIndex={1}>
                    <IntegrationSpoke
                        platform="battlenet"
                        status="placeholder"
                        label="Battle.net"
                        statusText=""
                        tooltipText="Click to link Battle.net for character data"
                        angle={120}
                    />
                    <IntegrationSpoke
                        platform="steam"
                        status="placeholder"
                        label="Steam"
                        statusText=""
                        tooltipText="Click to link Steam for game ownership & wishlist data"
                        angle={240}
                    />
                </OrbitRing>

                {/* COMMS Ring (Outer) — AC-5: Discord Ghost Node */}
                <OrbitRing label="COMMS" radius={280} ringIndex={2}>
                    <GhostNode angle={0} glowing={discordHovered} active={hasDiscordLinked} />
                </OrbitRing>
            </div>

            {/* Avatar Selector Modal */}
            <AvatarSelectorModal
                isOpen={showAvatarModal}
                onClose={() => setShowAvatarModal(false)}
                currentAvatarUrl={currentAvatarUrl}
                avatarOptions={avatarOptions}
                onSelect={handleAvatarSelect}
            />

            {/* Discord Details Modal */}
            <DiscordDetailsModal
                isOpen={showDiscordModal}
                onClose={() => setShowDiscordModal(false)}
                username={user.username}
                discordId={user.discordId || ''}
                avatar={user.avatar || null}
                onRefresh={onRefresh}
            />
        </div>
    );
}
