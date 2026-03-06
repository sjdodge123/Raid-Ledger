import type { JSX } from 'react';
import type { UserRole } from '@raid-ledger/contract';
import { SteamIcon } from '../../components/icons/SteamIcon';
import { RoleBadge } from '../../components/ui/role-badge';
import { isDiscordLinked } from '../../lib/avatar';

/** User identity card with avatar and role badge */
// eslint-disable-next-line max-lines-per-function
export function UserIdentityCard({ user, currentAvatarUrl, onOpenAvatarModal }: {
    user: { username: string; role?: UserRole; discordId: string | null };
    currentAvatarUrl: string;
    onOpenAvatarModal: () => void;
}): JSX.Element {
    const hasDiscordLinked = isDiscordLinked(user.discordId);
    return (
        <div className="flex items-center gap-4 p-4 bg-panel rounded-lg border border-edge">
            <button type="button" onClick={onOpenAvatarModal} className="relative group flex-shrink-0" aria-label="Change avatar">
                <img src={currentAvatarUrl} alt={user.username}
                    className="w-16 h-16 rounded-full border-2 border-emerald-500/50 object-cover"
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </div>
            </button>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-foreground">{user.username}</span>
                    <RoleBadge role={user.role} />
                </div>
                {hasDiscordLinked ? (
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Discord linked
                        </span>
                    </div>
                ) : (
                    <p className="text-sm text-muted mt-0.5">Local account</p>
                )}
            </div>
        </div>
    );
}

/** Discord link CTA button */
export function DiscordLinkCta({ onLink }: { onLink: () => void }): JSX.Element {
    return (
        <div className="mt-4 p-4 bg-panel rounded-lg border border-edge">
            <p className="text-sm text-muted mb-3">Link your Discord account for authentication and notifications.</p>
            <button onClick={onLink}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                Link Discord Account
            </button>
        </div>
    );
}

/** Steam account section — linked or link CTA */
// eslint-disable-next-line max-lines-per-function
export function SteamSection({ steamStatus, linkSteam, unlinkSteam, syncLibrary }: {
    steamStatus: { data?: { linked: boolean; personaName?: string | null; isPublic?: boolean } | undefined };
    linkSteam: () => void;
    unlinkSteam: { mutate: () => void; isPending: boolean };
    syncLibrary: { mutate: () => void; isPending: boolean };
}): JSX.Element {
    if (steamStatus.data?.linked) {
        return (
            <div className="mt-4 p-4 bg-panel rounded-lg border border-edge">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#1B2838] flex items-center justify-center flex-shrink-0">
                            <SteamIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">{steamStatus.data.personaName || 'Steam Linked'}</span>
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    Linked
                                </span>
                            </div>
                            {steamStatus.data.isPublic === false && (
                                <p className="text-xs text-amber-400 mt-0.5">
                                    Profile is private — set Game Details to Public in{' '}
                                    <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener noreferrer" className="underline">Steam Privacy Settings</a>
                                    {' '}for library sync
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => syncLibrary.mutate()} disabled={syncLibrary.isPending} className="text-sm text-accent hover:text-accent/80 disabled:opacity-50">
                            {syncLibrary.isPending ? 'Syncing...' : 'Sync Library'}
                        </button>
                        <span className="text-muted">|</span>
                        <button onClick={() => unlinkSteam.mutate()} disabled={unlinkSteam.isPending} className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50">
                            {unlinkSteam.isPending ? 'Unlinking...' : 'Unlink'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div className="mt-4 p-4 bg-panel rounded-lg border border-edge">
            <p className="text-sm text-muted mb-3">Link your Steam account to sync your game library and playtime.</p>
            <button onClick={linkSteam} className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1B2838] hover:bg-[#2a475e] text-white font-medium rounded-lg transition-colors">
                <SteamIcon className="w-5 h-5" />
                Link Steam Account
            </button>
        </div>
    );
}

/** Auto-heart toggle for Discord-connected users (ROK-444) */
export function AutoHeartToggle({ enabled, onToggle, isPending }: {
    enabled: boolean; onToggle: (v: boolean) => void; isPending: boolean;
}): JSX.Element {
    return (
        <div className="mt-4 p-4 bg-panel rounded-lg border border-edge">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">Auto-heart games</h3>
                    <p className="text-sm text-muted mt-0.5">Automatically heart games you play for 5+ hours so you get notified about new events</p>
                </div>
                <button type="button" role="switch" aria-checked={enabled} onClick={() => onToggle(!enabled)} disabled={isPending}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-backdrop ${
                        enabled ? 'bg-emerald-600' : 'bg-overlay'
                    } ${isPending ? 'opacity-50' : ''}`}>
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
            </div>
        </div>
    );
}
