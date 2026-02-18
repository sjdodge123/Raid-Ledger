import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { API_BASE_URL } from '../../lib/config';
import { buildDiscordAvatarUrl, isDiscordLinked } from '../../lib/avatar';
import { toast } from '../../lib/toast';

export function ProfileDiscordPanel() {
    const { user } = useAuth();
    const { data: systemStatus } = useSystemStatus();

    if (!user) return null;

    // Redirect away if Discord OAuth isn't configured (prevents direct URL access)
    if (systemStatus && !systemStatus.discordConfigured) {
        return <Navigate to="/profile/identity" replace />;
    }

    const hasDiscordLinked = isDiscordLinked(user.discordId);
    const discordAvatarUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);

    const handleLinkDiscord = () => {
        const token = localStorage.getItem('raid_ledger_token');
        if (!token) {
            toast.error('Please log in again to link Discord');
            return;
        }
        window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;
    };

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-1">Discord Connection</h2>
                <p className="text-sm text-muted mb-5">
                    {hasDiscordLinked
                        ? 'Your Discord account is linked. This enables rich notifications and authentication.'
                        : 'Link your Discord account for authentication and notifications.'}
                </p>

                {hasDiscordLinked ? (
                    <div className="flex items-center gap-4 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                        {discordAvatarUrl && (
                            <img
                                src={discordAvatarUrl}
                                alt="Discord avatar"
                                className="w-12 h-12 rounded-full border-2 border-emerald-500/50"
                                onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                            />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">{user.username}</p>
                            <p className="text-xs text-muted truncate">Discord ID: {user.discordId}</p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Connected
                        </span>
                    </div>
                ) : (
                    <button
                        onClick={handleLinkDiscord}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                        </svg>
                        Link Discord Account
                    </button>
                )}
            </div>
        </div>
    );
}
