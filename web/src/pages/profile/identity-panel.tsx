import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { API_BASE_URL } from '../../lib/config';
import { buildDiscordAvatarUrl } from '../../lib/avatar';
import { RoleBadge } from '../../components/ui/role-badge';
import { toast } from '../../lib/toast';
import { AvatarSelectorModal } from '../../components/profile/AvatarSelectorModal';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';

const AVATAR_PREF_KEY = 'raid-ledger:avatar-preference';

function buildAvatarOptions(user: { discordId: string | null; avatar: string | null; customAvatarUrl: string | null }, characters: { avatarUrl: string | null; name: string }[]) {
    const options: { url: string; label: string }[] = [];
    if (user.customAvatarUrl) {
        options.push({ url: `${API_BASE_URL}${user.customAvatarUrl}`, label: 'Custom' });
    }
    const hasDiscordLinked = user.discordId && !user.discordId.startsWith('local:');
    const discordUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    if (hasDiscordLinked && discordUrl) {
        options.push({ url: discordUrl, label: 'Discord' });
    }
    for (const char of characters) {
        if (char.avatarUrl) {
            options.push({ url: char.avatarUrl, label: char.name });
        }
    }
    return options;
}

export function IdentityPanel() {
    const { user, isAuthenticated, refetch } = useAuth();
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);
    const [showAvatarModal, setShowAvatarModal] = useState(false);
    const { upload: uploadAvatarFile, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();

    const [avatarIndex, setAvatarIndex] = useState(() => {
        const stored = localStorage.getItem(AVATAR_PREF_KEY);
        return stored ? parseInt(stored, 10) : 0;
    });

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

    const characters = charactersData?.data ?? [];
    const avatarOptions = user ? buildAvatarOptions(user, characters) : [];

    const handleAvatarSelect = useCallback((url: string) => {
        const idx = avatarOptions.findIndex(o => o.url === url);
        if (idx >= 0) { setAvatarIndex(idx); localStorage.setItem(AVATAR_PREF_KEY, String(idx)); }
    }, [avatarOptions]);

    if (!user) return null;

    const hasDiscordLinked = Boolean(user.discordId && !user.discordId.startsWith('local:'));

    const currentAvatarUrl = avatarOptions.length > 0 && avatarIndex >= 0 && avatarIndex < avatarOptions.length
        ? avatarOptions[avatarIndex].url
        : buildDiscordAvatarUrl(user.discordId, user.avatar) ?? '/default-avatar.svg';

    return (
        <div className="space-y-6">
            {/* Identity overview */}
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">Identity</h2>
                <p className="text-sm text-muted mb-6">Your profile identity and linked accounts.</p>

                {/* User card */}
                <div className="flex items-center gap-4 p-4 bg-panel rounded-lg border border-edge mb-4">
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
                        <p className="text-sm text-muted mt-0.5">{user.email || 'No email set'}</p>
                    </div>
                </div>

                {/* Quick links */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Link
                        to="/profile/identity/discord"
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                            hasDiscordLinked
                                ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
                                : 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                        }`}
                    >
                        <svg className={`w-5 h-5 ${hasDiscordLinked ? 'text-emerald-400' : 'text-amber-400'}`} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.04.001-.088-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                        </svg>
                        <div>
                            <span className="text-sm font-medium text-foreground">Discord</span>
                            <p className={`text-xs ${hasDiscordLinked ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {hasDiscordLinked ? 'Connected' : 'Not linked'}
                            </p>
                        </div>
                    </Link>

                    <Link
                        to="/profile/identity/avatar"
                        className="flex items-center gap-3 p-3 rounded-lg border border-edge hover:bg-overlay/20 transition-colors"
                    >
                        <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <div>
                            <span className="text-sm font-medium text-foreground">Avatar</span>
                            <p className="text-xs text-muted">
                                {avatarOptions.length} option{avatarOptions.length !== 1 ? 's' : ''} available
                            </p>
                        </div>
                    </Link>
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
