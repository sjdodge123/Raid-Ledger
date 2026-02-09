import { useState, useEffect, useCallback } from 'react';
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
import { useOrbitalAnimation } from './use-orbital-animation';
import './integration-hub.css';

const AVATAR_PREF_KEY = 'raid-ledger:avatar-preference';

interface IntegrationHubProps {
    user: User;
    characters: CharacterDto[];
    onRefresh?: () => void;
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

/**
 * Hub & Spoke Integration Widget (ROK-195)
 * 3 concentric orbital rings (AUTH/GAMING/COMMS) with hexagonal platform nodes
 */
export function IntegrationHub({ user, characters, onRefresh }: IntegrationHubProps) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [showAvatarModal, setShowAvatarModal] = useState(false);

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

    // Trig-based orbital animation — icons stay upright naturally
    const orbitRef = useOrbitalAnimation(true);

    return (
        <div className="bg-slate-900/70 backdrop-blur-sm border border-slate-800 rounded-xl overflow-hidden">
            <div className="integration-hub" ref={orbitRef}>
                {/* Star particle background */}
                <div className="integration-hub__stars" />

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
                        onViewDetails={() => toast.info('Discord account is linked.')}
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
        </div>
    );
}
