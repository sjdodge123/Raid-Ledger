import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { API_BASE_URL } from '../../lib/config';
import { buildDiscordAvatarUrl, isDiscordLinked, resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { AvatarType } from '../../lib/avatar';
import { toast } from '../../lib/toast';
import { updatePreference } from '../../lib/api-client';

function buildAvatarOptions(user: { customAvatarUrl?: string | null; discordId?: string | null; avatar?: string | null }, characters: { avatarUrl?: string | null; name: string }[]) {
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

export function AvatarPanel() {
    const { user, isAuthenticated, refetch } = useAuth();
    const queryClient = useQueryClient();
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);
    const { upload: uploadAvatarFile, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();

    const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        uploadAvatarFile(file, {
            onSuccess: () => { toast.success('Avatar uploaded successfully!'); refetch(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Upload failed'); },
        });
    }, [uploadAvatarFile, refetch]);

    const handleRemoveCustom = useCallback(() => {
        deleteAvatar(undefined, {
            onSuccess: () => { toast.success('Custom avatar removed'); refetch(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to remove avatar'); },
        });
    }, [deleteAvatar, refetch]);

    if (!user) return null;

    const characters = charactersData?.data ?? [];
    const options = buildAvatarOptions(user, characters);

    const avatarUser = toAvatarUser({ ...user, characters });
    const resolved = resolveAvatar(avatarUser);
    const currentUrl = resolved.url ?? '/default-avatar.svg';

    const handleSelect = (url: string) => {
        const option = options.find(o => o.url === url);
        if (!option) return;
        const pref = option.type === 'character'
            ? { type: option.type, characterName: option.characterName, avatarUrl: option.url }
            : { type: option.type };
        updatePreference('avatarPreference', pref)
            .then(() => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }))
            .catch(() => toast.error('Failed to save avatar preference'));
    };

    // Determine current label from resolved avatar
    const currentLabel = options.find(o => o.url === currentUrl)?.label ?? 'Default';

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-1">Avatar</h2>
                <p className="text-sm text-muted mb-5">Choose or upload your profile picture</p>

                <div className="flex items-center gap-4 mb-6">
                    <img
                        src={currentUrl}
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

                {options.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-sm font-medium text-secondary mb-3">Available Avatars</h3>
                        <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-3">
                            {options.map((opt) => (
                                <button
                                    key={opt.url}
                                    onClick={() => handleSelect(opt.url)}
                                    className={`relative group rounded-full ${
                                        currentUrl === opt.url
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
                            onChange={handleUpload}
                            disabled={isUploading}
                        />
                    </label>
                    {user.customAvatarUrl && (
                        <button
                            onClick={handleRemoveCustom}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium rounded-lg transition-colors border border-red-500/20"
                        >
                            Remove Custom
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
