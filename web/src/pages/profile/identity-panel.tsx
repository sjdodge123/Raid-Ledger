import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
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

export function IdentityPanel() {
    const { user, isAuthenticated, refetch } = useAuth();
    const queryClient = useQueryClient();
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);
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

    const handleAvatarSelect = useCallback((url: string) => {
        const option = avatarOptions.find(o => o.url === url);
        if (!option) return;
        const pref = option.type === 'character'
            ? { type: option.type, characterName: option.characterName }
            : { type: option.type };
        updatePreference('avatarPreference', pref)
            .then(() => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }))
            .catch(() => toast.error('Failed to save avatar preference'));
    }, [avatarOptions, queryClient]);

    if (!user) return null;

    const avatarUser = toAvatarUser({ ...user, characters });
    const resolved = resolveAvatar(avatarUser);
    const currentAvatarUrl = resolved.url ?? '/default-avatar.svg';

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
                        <p className="text-sm text-muted mt-0.5">{isDiscordLinked(user.discordId) ? 'Discord linked' : 'Local account'}</p>
                    </div>
                </div>
            </div>

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
