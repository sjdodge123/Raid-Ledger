/**
 * Integrations panel showing Discord and Steam link status (ROK-548).
 * Reuses DiscordLinkCta and SteamSection from identity-sections.
 */
import type { JSX } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useDiscordLink } from '../../hooks/use-discord-link';
import { useSteamLink } from '../../hooks/use-steam-link';
import { isDiscordLinked, buildDiscordAvatarUrl } from '../../lib/avatar';
import { DiscordLinkCta, SteamSection } from './identity-sections';
import { useSteamRedirectFeedback } from './identity-hooks';

/** Discord linked status display */
function DiscordLinkedStatus({ user }: {
    user: { username: string; discordId: string | null; avatar: string | null };
}): JSX.Element {
    const avatarUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    return (
        <div className="flex items-center gap-4 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            {avatarUrl && (
                <img src={avatarUrl} alt="Discord avatar" className="w-12 h-12 rounded-full border-2 border-emerald-500/50"
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
            )}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{user.username}</p>
                <p className="text-xs text-emerald-400">Discord linked</p>
            </div>
        </div>
    );
}

/** Integrations panel with Discord and Steam sections. */
export function IntegrationsPanel(): JSX.Element | null {
    useSteamRedirectFeedback();
    const { user } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const handleLinkDiscord = useDiscordLink();
    const { linkSteam, steamStatus, unlinkSteam, syncLibrary, syncWishlist } = useSteamLink();

    if (!user) return null;

    const hasDiscord = isDiscordLinked(user.discordId);
    const showDiscord = !!systemStatus?.discordConfigured;
    const showSteam = !!systemStatus?.steamConfigured;

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-1">Integrations</h2>
                <p className="text-sm text-muted mb-5">Manage your linked accounts and external services.</p>
                {showDiscord && (
                    hasDiscord
                        ? <DiscordLinkedStatus user={user} />
                        : <DiscordLinkCta onLink={handleLinkDiscord} />
                )}
                {showSteam && (
                    <SteamSection steamStatus={steamStatus} linkSteam={linkSteam}
                        unlinkSteam={unlinkSteam} syncLibrary={syncLibrary} syncWishlist={syncWishlist} />
                )}
            </div>
        </div>
    );
}
