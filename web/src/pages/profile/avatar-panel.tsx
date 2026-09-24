import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, type User } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { API_BASE_URL } from '../../lib/config';
import { buildDiscordAvatarUrl, isDiscordLinked, resolveAvatar, getCurrentUserAvatarData, setCurrentUserAvatarData } from '../../lib/avatar';
import { toast } from '../../lib/toast';
import { updatePreference } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { FilePicker } from '../../components/ui/file-picker';

const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

type SelectableAvatarType = 'custom' | 'discord' | 'character';

function buildAvatarOptions(user: { customAvatarUrl?: string | null; discordId?: string | null; avatar?: string | null }, characters: { avatarUrl?: string | null; name: string }[]) {
    const options: { url: string; label: string; type: SelectableAvatarType; characterName?: string }[] = [];
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

/** Eagerly push avatar preference into React Query cache + module-level overlay. */
function applyAvatarOptimistic(
    queryClient: ReturnType<typeof useQueryClient>,
    pref: { type: SelectableAvatarType; characterName?: string },
    opts?: { resolvedAvatarUrl?: string; customAvatarUrl?: string },
) {
    queryClient.setQueryData<User | null>(['auth', 'me'], (old) => {
        if (!old) return old;
        const update: Partial<User> = { avatarPreference: pref };
        if (opts?.customAvatarUrl !== undefined) update.customAvatarUrl = opts.customAvatarUrl;
        return { ...old, ...update };
    });
    const cached = getCurrentUserAvatarData();
    if (cached) setCurrentUserAvatarData({
        ...cached, avatarPreference: pref,
        resolvedAvatarUrl: opts?.resolvedAvatarUrl ?? cached.resolvedAvatarUrl,
        customAvatarUrl: opts?.customAvatarUrl ?? cached.customAvatarUrl,
    });
}

function useUploadHandler(queryClient: ReturnType<typeof useQueryClient>, uploadAsync: (file: File) => Promise<{ customAvatarUrl: string }>, setOptimisticUrl: (url: string | null) => void) {
    return useCallback(async (file: File) => {
        try {
            const result = await uploadAsync(file);
            toast.success('Avatar uploaded successfully!');
            setOptimisticUrl(`${API_BASE_URL}${result.customAvatarUrl}`);
            applyAvatarOptimistic(queryClient, { type: 'custom' }, { customAvatarUrl: result.customAvatarUrl });
            updatePreference('avatarPreference', { type: 'custom' }).catch(() => toast.error('Failed to save avatar preference'));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Upload failed');
        }
    }, [uploadAsync, queryClient, setOptimisticUrl]);
}

function useAvatarHandlers(refetch: () => void) {
    const queryClient = useQueryClient();
    const { uploadAsync, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();
    const [optimisticUrl, setOptimisticUrl] = useState<string | null>(null);
    const handleUpload = useUploadHandler(queryClient, uploadAsync, setOptimisticUrl);

    const handleRemoveCustom = useCallback(() => {
        deleteAvatar(undefined, {
            onSuccess: () => { toast.success('Custom avatar removed'); refetch(); setOptimisticUrl(null); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to remove avatar'); },
        });
    }, [deleteAvatar, refetch]);

    const handleSelect = useCallback((url: string, options: ReturnType<typeof buildAvatarOptions>) => {
        const option = options.find(o => o.url === url);
        if (!option) return;
        setOptimisticUrl(url);
        toast.success('Avatar updated!');
        const pref = option.type === 'character' ? { type: option.type, characterName: option.characterName } : { type: option.type };
        const resolvedAvatarUrl = option.type === 'character' ? url : undefined;
        applyAvatarOptimistic(queryClient, pref, { resolvedAvatarUrl });
        updatePreference('avatarPreference', pref)
            .catch(() => { toast.error('Failed to save avatar preference'); setOptimisticUrl(null); });
    }, [queryClient]);

    return { handleUpload, handleRemoveCustom, handleSelect, isUploading, uploadProgress, optimisticUrl };
}

function AvatarPreview({ currentUrl, username, currentLabel }: { currentUrl: string; username: string; currentLabel: string }) {
    return (
        <div className="flex items-center gap-4 mb-6">
            <img src={currentUrl} alt={username} className="w-20 h-20 rounded-full border-2 border-success/50 object-cover" onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
            <div>
                <p className="text-sm font-medium text-foreground">{currentLabel} avatar</p>
                <p className="text-xs text-muted">Click below to change</p>
            </div>
        </div>
    );
}

/** One selectable avatar: a ghost Button named by its label; the current one is aria-pressed and ringed. */
function AvatarOptionTile({ url, label, pressed, onSelect }: { url: string; label: string; pressed: boolean; onSelect: (url: string) => void }) {
    return (
        <Button variant="ghost" size="sm" aria-label={label} aria-pressed={pressed} onClick={() => onSelect(url)} className="group">
            <span className="flex flex-col items-center gap-1">
                <img src={url} alt="" className={`w-14 h-14 rounded-full object-cover transition-shadow ${pressed ? 'ring-2 ring-success' : 'group-hover:ring-2 group-hover:ring-edge-strong'}`}
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
                <span className={`max-w-[5rem] truncate text-[10px] ${pressed ? 'text-foreground' : 'text-muted'}`}>{label}</span>
            </span>
        </Button>
    );
}

function AvatarOptionsGrid({ options, currentUrl, onSelect }: { options: ReturnType<typeof buildAvatarOptions>; currentUrl: string; onSelect: (url: string) => void }) {
    if (options.length === 0) return null;
    return (
        <div className="mb-6">
            <h3 className="text-sm font-medium text-secondary mb-3">Available Avatars</h3>
            <div className="flex flex-wrap gap-2">
                {options.map((opt) => (
                    <AvatarOptionTile key={opt.url} url={opt.url} label={opt.label} pressed={currentUrl === opt.url} onSelect={onSelect} />
                ))}
            </div>
        </div>
    );
}

function AvatarUploadBar({ isUploading, uploadProgress, onUpload, onRemove, hasCustom }: {
    isUploading: boolean; uploadProgress: number; onUpload: (file: File) => void; onRemove: () => void; hasCustom: boolean;
}) {
    // Ruling 7 exception: the upload percentage stays the visible label, so this is `disabled`, not `loading`.
    return (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-edge-subtle">
            <FilePicker variant="primary" accept={AVATAR_ACCEPT} disabled={isUploading} onFiles={(files) => onUpload(files[0])}>
                <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                {isUploading ? `Uploading ${uploadProgress}%` : 'Upload Custom'}
            </FilePicker>
            {hasCustom && <Button variant="destructive-soft" onClick={onRemove}>Remove Custom</Button>}
        </div>
    );
}

export function AvatarPanel() {
    const { user, isAuthenticated, refetch } = useAuth();
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);
    const handlers = useAvatarHandlers(refetch);

    if (!user) return null;

    const characters = charactersData?.data ?? [];
    const options = buildAvatarOptions(user, characters);
    // Bypass toAvatarUser() which uses a global cache that lags one render cycle behind.
    // Build AvatarUser directly from fresh auth user data so resolveAvatar sees the latest preference.
    const discordUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    const avatarUser = {
        avatar: discordUrl ?? (user.avatar?.startsWith('http') ? user.avatar : null),
        customAvatarUrl: user.customAvatarUrl,
        characters: characters.map(c => ({ gameId: '__resolved__' as const, name: c.name, avatarUrl: c.avatarUrl ?? null })),
        avatarPreference: user.avatarPreference,
    };
    const resolvedUrl = resolveAvatar(avatarUser).url ?? '/default-avatar.svg';
    const displayUrl = handlers.optimisticUrl ?? resolvedUrl;
    const displayLabel = options.find(o => o.url === displayUrl)?.label ?? 'Default';

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-1">Avatar</h2>
                <p className="text-sm text-muted mb-5">Choose or upload your profile picture</p>
                <AvatarPreview currentUrl={displayUrl} username={user.username} currentLabel={displayLabel} />
                <AvatarOptionsGrid options={options} currentUrl={displayUrl} onSelect={(url) => handlers.handleSelect(url, options)} />
                <AvatarUploadBar isUploading={handlers.isUploading} uploadProgress={handlers.uploadProgress} onUpload={handlers.handleUpload} onRemove={handlers.handleRemoveCustom} hasCustom={!!user.customAvatarUrl} />
            </div>
        </div>
    );
}
