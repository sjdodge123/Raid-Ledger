import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useDiscordMembership } from '../../hooks/use-discord-membership';

const DISMISS_KEY = 'discord-join-banner-dismissed';

function isSuppressedRoute(pathname: string): boolean {
    // Exact matches
    if (pathname === '/' || pathname === '/login' || pathname === '/auth/success' || pathname === '/join') {
        return true;
    }
    // Prefix matches
    if (pathname.startsWith('/i/') || pathname.startsWith('/onboarding') || pathname.startsWith('/admin/setup')) {
        return true;
    }
    return false;
}

/**
 * ROK-425: Persistent but dismissible banner encouraging users to join the
 * community Discord server. Shows when the user is authenticated, has a
 * Discord account linked, but is NOT a member of the bot's guild.
 */
export function DiscordJoinBanner() {
    const { pathname } = useLocation();
    const { user, isAuthenticated } = useAuth();
    const { data } = useDiscordMembership();

    const [dismissed, setDismissed] = useState(
        () => localStorage.getItem(DISMISS_KEY) === 'true',
    );

    const handleDismiss = useCallback(() => {
        localStorage.setItem(DISMISS_KEY, 'true');
        setDismissed(true);
    }, []);

    // Don't show on suppressed routes
    if (isSuppressedRoute(pathname)) return null;

    // Don't show if not authenticated
    if (!isAuthenticated || !user) return null;

    // Don't show if user has no Discord account linked
    if (!user.discordId) return null;

    // Don't show if data hasn't loaded or bot isn't connected
    if (!data?.botConnected) return null;

    // Don't show if user is already a member
    if (data.isMember) return null;

    // Don't show if dismissed
    if (dismissed) return null;

    return (
        <div className="flex items-center justify-between gap-3 bg-[#5865F2] px-4 py-2.5 text-sm text-white shadow-md">
            <div className="flex items-center gap-2 min-w-0">
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                </svg>
                <span className="truncate">
                    You&apos;re not in the <strong>{data.guildName}</strong> Discord server yet
                    — join to get event notifications and voice chat!
                </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {data.inviteUrl && (
                    <a
                        href={data.inviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md bg-white/20 px-3 py-1 text-sm font-medium text-white hover:bg-white/30 transition-colors"
                    >
                        Join Server
                    </a>
                )}
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="rounded p-1 hover:bg-white/20 transition-colors"
                    aria-label="Dismiss Discord join banner"
                >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                        />
                    </svg>
                </button>
            </div>
        </div>
    );
}
