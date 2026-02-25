import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useSystemStatus } from '../../hooks/use-system-status';
import { API_BASE_URL } from '../../lib/config';
import { buildDiscordAvatarUrl, isDiscordLinked, resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { AvatarType } from '../../lib/avatar';
import { RoleBadge } from '../../components/ui/role-badge';
import { toast } from '../../lib/toast';
import { AvatarSelectorModal } from '../../components/profile/AvatarSelectorModal';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { updatePreference } from '../../lib/api-client';

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
 * Merges the old My Profile, Discord, and Avatar panels into a single page.
 */
export function IdentityPanel() {
    const { user, isAuthenticated, refetch } = useAuth();
    const queryClient = useQueryClient();
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);
    const { data: systemStatus } = useSystemStatus();
    const [showAvatarModal, setShowAvatarModal] = useState(false);
    const { upload: uploadAvatarFile, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();

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

    if (!user) return null;

    const avatarUser = toAvatarUser({ ...user, characters });
    const resolved = resolveAvatar(avatarUser);
    const resolvedAvatarUrl = resolved.url ?? '/default-avatar.svg';
    // Use optimistic URL when a selection is pending, otherwise use resolved
    const currentAvatarUrl = optimisticUrl ?? resolvedAvatarUrl;

    const hasDiscordLinked = isDiscordLinked(user.discordId);
    const discordAvatarUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    const showDiscord = systemStatus?.discordConfigured;

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
            {/* Identity overview */}
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">Identity</h2>
                <p className="text-sm text-muted mb-6">Your profile identity and linked accounts.</p>

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
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-foreground">{user.username}</span>
                            <RoleBadge role={user.role} />
                        </div>
                        <p className="text-sm text-muted mt-0.5">{hasDiscordLinked ? 'Discord linked' : 'Local account'}</p>
                    </div>
                </div>
            </div>

            {/* Discord Connection (conditionally shown when Discord OAuth is configured) */}
            {showDiscord && (
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
            )}

            {/* Avatar section */}
            <AvatarSection
                user={user}
                currentAvatarUrl={currentAvatarUrl}
                avatarOptions={avatarOptions}
                onSelect={handleAvatarSelect}
                onUpload={handleUpload}
                onRemoveCustom={handleRemoveCustomAvatar}
                isUploading={isUploading}
                uploadProgress={uploadProgress}
            />

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
        </div>
    );
}

/** Inline avatar picker section within the consolidated Identity panel */
function AvatarSection({
    user,
    currentAvatarUrl,
    avatarOptions,
    onSelect,
    onUpload,
    onRemoveCustom,
    isUploading,
    uploadProgress,
}: {
    user: { username: string; customAvatarUrl: string | null };
    currentAvatarUrl: string;
    avatarOptions: { url: string; label: string; type: AvatarType; characterName?: string }[];
    onSelect: (url: string) => void;
    onUpload: (file: File) => void;
    onRemoveCustom: () => void;
    isUploading: boolean;
    uploadProgress: number;
}) {
    const currentLabel = avatarOptions.find(o => o.url === currentAvatarUrl)?.label ?? 'Default';

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onUpload(file);
    }, [onUpload]);

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">Avatar</h2>
            <p className="text-sm text-muted mb-5">Choose or upload your profile picture</p>

            <div className="flex items-center gap-4 mb-6">
                <img
                    src={currentAvatarUrl}
                    alt={user.username}
                    className="w-20 h-20 rounded-full border-2 border-emerald-500/50 object-cover"
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                />
                <div>
                    <p className="text-sm font-medium text-foreground">
                        {currentLabel} avatar
                    </p>
                    <p className="text-xs text-muted">Click below to change</p>
                </div>
            </div>

            {avatarOptions.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-sm font-medium text-secondary mb-3">Available Avatars</h3>
                    <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-3">
                        {avatarOptions.map((opt) => (
                            <button
                                key={opt.url}
                                onClick={() => onSelect(opt.url)}
                                className={`relative group rounded-full ${
                                    currentAvatarUrl === opt.url
                                        ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-surface'
                                        : 'hover:ring-2 hover:ring-edge-strong hover:ring-offset-2 hover:ring-offset-surface'
                                }`}
                            >
                                <img
                                    src={opt.url}
                                    alt={opt.label}
                                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover"
                                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }}
                                />
                                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-muted whitespace-nowrap">
                                    {opt.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-3 pt-2 border-t border-edge-subtle">
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-foreground font-medium rounded-lg transition-colors cursor-pointer">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    {isUploading ? `Uploading ${uploadProgress}%` : 'Upload Custom'}
                    <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={isUploading}
                    />
                </label>
                {user.customAvatarUrl && (
                    <button
                        onClick={onRemoveCustom}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium rounded-lg transition-colors border border-red-500/20"
                    >
                        Remove Custom
                    </button>
                )}
            </div>
        </div>
    );
}
