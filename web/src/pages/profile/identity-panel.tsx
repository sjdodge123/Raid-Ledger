import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth, isImpersonating } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useDiscordLink } from '../../hooks/use-discord-link';
import { buildDiscordAvatarUrl, isDiscordLinked, resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { AvatarType } from '../../lib/avatar';
import { RoleBadge } from '../../components/ui/role-badge';
import { toast } from '../../lib/toast';
import { AvatarSelectorModal } from '../../components/profile/AvatarSelectorModal';
import { Modal } from '../../components/ui/modal';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { getMyPreferences, updatePreference, deleteMyAccount } from '../../lib/api-client';
import { API_BASE_URL } from '../../lib/config';

function buildAvatarOptions(user: { discordId: string | null; avatar: string | null; customAvatarUrl: string | null }, characters: { avatarUrl: string | null; name: string }[]) {
    const options: { url: string; label: string; type: AvatarType; characterName?: string }[] = [];
    if (user.customAvatarUrl) {
        options.push({ url: `${API_BASE_URL}${user.customAvatarUrl}`, label: 'Custom', type: 'custom' });
    }
    const hasDiscordLinked = isDiscordLinked(user.discordId);
    const discordUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    if (hasDiscordLinked && discordUrl) {
        options.push({ url: discordUrl, label: 'Discord', type: 'discord' });
    }
    for (const char of characters) {
        if (char.avatarUrl) {
            options.push({ url: char.avatarUrl, label: char.name, type: 'character', characterName: char.name });
        }
    }
    return options;
}

/**
 * Consolidated Identity panel (ROK-359).
 * Merges the old My Profile, Discord, Avatar, and Account panels into a single page.
 */
export function IdentityPanel() {
    const { user, isAuthenticated, refetch, logout } = useAuth();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);
    const { data: systemStatus } = useSystemStatus();
    const [showAvatarModal, setShowAvatarModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [confirmName, setConfirmName] = useState('');
    const { upload: uploadAvatarFile, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();
    const handleLinkDiscord = useDiscordLink();

    const handleUpload = useCallback((file: File) => {
        uploadAvatarFile(file, {
            onSuccess: () => { toast.success('Avatar uploaded successfully!'); refetch(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Upload failed'); },
        });
    }, [uploadAvatarFile, refetch]);

    const handleRemoveCustomAvatar = useCallback(() => {
        deleteAvatar(undefined, {
            onSuccess: () => { toast.success('Custom avatar removed'); refetch(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to remove avatar'); },
        });
    }, [deleteAvatar, refetch]);

    const characters = useMemo(() => charactersData?.data ?? [], [charactersData?.data]);
    const avatarOptions = useMemo(
        () => (user ? buildAvatarOptions(user, characters) : []),
        [user, characters],
    );

    // Optimistic selection so the UI responds immediately to clicks (ROK-352)
    const [optimisticUrl, setOptimisticUrl] = useState<string | null>(null);

    const handleAvatarSelect = useCallback((url: string) => {
        const option = avatarOptions.find(o => o.url === url);
        if (!option) return;

        // Show selection ring immediately
        setOptimisticUrl(url);

        const pref = option.type === 'character'
            ? { type: option.type, characterName: option.characterName }
            : { type: option.type };
        updatePreference('avatarPreference', pref)
            .then(() => {
                queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
                setOptimisticUrl(null); // Clear after server confirms
            })
            .catch(() => {
                toast.error('Failed to save avatar preference');
                setOptimisticUrl(null); // Revert on error
            });
    }, [avatarOptions, queryClient]);

    const expectedName = user?.displayName || user?.username || '';
    const deleteMutation = useMutation({
        mutationFn: () => deleteMyAccount(confirmName),
        onSuccess: () => {
            logout();
            toast.success('Your account has been deleted');
            navigate('/login', { replace: true });
        },
        onError: (err) => {
            toast.error(err instanceof Error ? err.message : 'Failed to delete account');
        },
    });
    const isConfirmValid = confirmName === expectedName;

    const hasDiscordLinked = isDiscordLinked(user?.discordId ?? null);

    // Auto-heart preference (ROK-444)
    const { data: prefs } = useQuery({
        queryKey: ['user-preferences'],
        queryFn: getMyPreferences,
        enabled: isAuthenticated && hasDiscordLinked,
        staleTime: Infinity,
    });
    const autoHeartEnabled = prefs?.autoHeartGames !== false;
    const autoHeartMutation = useMutation({
        mutationFn: (enabled: boolean) => updatePreference('autoHeartGames', enabled),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-preferences'] });
        },
        onError: () => {
            toast.error('Failed to update auto-heart preference');
        },
    });

    if (!user) return null;

    const showDangerZone = !isImpersonating();
    const avatarUser = toAvatarUser({ ...user, characters });
    const resolved = resolveAvatar(avatarUser);
    const resolvedAvatarUrl = resolved.url ?? '/default-avatar.svg';
    // Use optimistic URL when a selection is pending, otherwise use resolved
    const currentAvatarUrl = optimisticUrl ?? resolvedAvatarUrl;

    const showDiscord = systemStatus?.discordConfigured;

    return (
        <div className="space-y-6">
            {/* Identity overview */}
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">Identity</h2>
                <p className="text-sm text-muted mb-6">Your profile identity and linked accounts. Click your avatar to change it.</p>

                {/* User card */}
                <div className="flex items-center gap-4 p-4 bg-panel rounded-lg border border-edge">
                    <button
                        type="button"
                        onClick={() => setShowAvatarModal(true)}
                        className="relative group flex-shrink-0"
                        aria-label="Change avatar"
                    >
                        <img
                            src={currentAvatarUrl}
                            alt={user.username}
                            className="w-16 h-16 rounded-full border-2 border-emerald-500/50 object-cover"
                            onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                        />
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

                {/* Discord link CTA — only shown when Discord OAuth is configured but not yet linked */}
                {showDiscord && !hasDiscordLinked && (
                    <div className="mt-4 p-4 bg-panel rounded-lg border border-edge">
                        <p className="text-sm text-muted mb-3">Link your Discord account for authentication and notifications.</p>
                        <button
                            onClick={handleLinkDiscord}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                            </svg>
                            Link Discord Account
                        </button>
                    </div>
                )}

                {/* Auto-heart toggle — only shown when Discord is connected (ROK-444) */}
                {hasDiscordLinked && (
                    <div className="mt-4 p-4 bg-panel rounded-lg border border-edge">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Auto-heart games</h3>
                                <p className="text-sm text-muted mt-0.5">
                                    Automatically heart games you play for 5+ hours so you get notified about new events
                                </p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={autoHeartEnabled}
                                onClick={() => autoHeartMutation.mutate(!autoHeartEnabled)}
                                disabled={autoHeartMutation.isPending}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-backdrop ${
                                    autoHeartEnabled ? 'bg-emerald-600' : 'bg-overlay'
                                } ${autoHeartMutation.isPending ? 'opacity-50' : ''}`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        autoHeartEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Danger Zone — account deletion (consolidated from Account panel) */}
            {showDangerZone && (
                <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-6">
                    <h2 className="text-xl font-semibold text-red-400 mb-1">Danger Zone</h2>
                    <p className="text-sm text-muted mb-6">Irreversible actions that permanently affect your account.</p>

                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Delete My Account</h3>
                                <p className="text-sm text-muted mt-1">
                                    Permanently delete your account, characters, event signups,
                                    and all associated data. This cannot be undone.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowDeleteModal(true)}
                                className="flex-shrink-0 px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm rounded-lg transition-colors"
                            >
                                Delete My Account
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <AvatarSelectorModal
                isOpen={showAvatarModal}
                onClose={() => setShowAvatarModal(false)}
                currentAvatarUrl={currentAvatarUrl}
                avatarOptions={avatarOptions}
                onSelect={handleAvatarSelect}
                customAvatarDisplayUrl={user.customAvatarUrl ? `${API_BASE_URL}${user.customAvatarUrl}` : null}
                onUpload={handleUpload}
                onRemoveCustom={handleRemoveCustomAvatar}
                isUploading={isUploading}
                uploadProgress={uploadProgress}
            />

            <Modal
                isOpen={showDeleteModal}
                onClose={() => { setShowDeleteModal(false); setConfirmName(''); }}
                title="Delete Account"
            >
                <div className="space-y-4">
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-sm text-red-400 font-medium mb-1">
                            This action is permanent and cannot be undone.
                        </p>
                        <p className="text-sm text-red-400/80">
                            This will permanently delete your account, characters,
                            event signups, and all associated data.
                        </p>
                    </div>

                    <div>
                        <label htmlFor="confirm-name" className="block text-sm text-secondary mb-1.5">
                            Type <strong className="text-foreground">{expectedName}</strong> to confirm
                        </label>
                        <input
                            id="confirm-name"
                            type="text"
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            placeholder={expectedName}
                            className="w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                            autoComplete="off"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={() => { setShowDeleteModal(false); setConfirmName(''); }}
                            className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => deleteMutation.mutate()}
                            disabled={!isConfirmValid || deleteMutation.isPending}
                            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                        >
                            {deleteMutation.isPending ? 'Deleting...' : 'Delete My Account'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

