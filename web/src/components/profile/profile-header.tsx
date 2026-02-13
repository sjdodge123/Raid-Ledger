import { useCallback, useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from '../../lib/toast';
import type { User } from '../../hooks/use-auth';
import type { CharacterDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../../lib/config';
import { buildDiscordAvatarUrl } from '../../lib/avatar';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { RoleBadge } from '../ui/role-badge';
import { AvatarSelectorModal } from './AvatarSelectorModal';
import { DiscordDetailsModal } from './DiscordDetailsModal';

const AVATAR_PREF_KEY = 'raid-ledger:avatar-preference';

interface ProfileHeaderProps {
    user: User;
    characters: CharacterDto[];
    onRefresh?: () => void;
}

function buildAvatarOptions(user: User, characters: CharacterDto[]) {
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

function resolveCurrentAvatar(options: { url: string; label: string }[], prefIndex: number, user: User): string {
    if (options.length > 0 && prefIndex >= 0 && prefIndex < options.length) {
        return options[prefIndex].url;
    }
    const fallbackDiscordUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    if (fallbackDiscordUrl) return fallbackDiscordUrl;
    return '/default-avatar.svg';
}

export function ProfileHeader({ user, characters, onRefresh }: ProfileHeaderProps) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [showAvatarModal, setShowAvatarModal] = useState(false);
    const [showDiscordModal, setShowDiscordModal] = useState(false);
    const { upload: uploadAvatarFile, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();

    const handleUpload = useCallback((file: File) => {
        uploadAvatarFile(file, {
            onSuccess: () => { toast.success('Avatar uploaded successfully!'); onRefresh?.(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Upload failed'); },
        });
    }, [uploadAvatarFile, onRefresh]);

    const handleRemoveCustomAvatar = useCallback(() => {
        deleteAvatar(undefined, {
            onSuccess: () => { toast.success('Custom avatar removed'); onRefresh?.(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to remove avatar'); },
        });
    }, [deleteAvatar, onRefresh]);

    const [avatarIndex, setAvatarIndex] = useState(() => {
        const stored = localStorage.getItem(AVATAR_PREF_KEY);
        return stored ? parseInt(stored, 10) : 0;
    });

    const processedRef = useRef(false);
    useEffect(() => {
        if (processedRef.current) return;
        const linked = searchParams.get('linked');
        const message = searchParams.get('message');
        if (linked === 'success') {
            processedRef.current = true;
            toast.success('Discord account linked successfully!');
            setSearchParams({});
            onRefresh?.();
        } else if (linked === 'error') {
            processedRef.current = true;
            toast.error(message || 'Failed to link Discord account');
            setSearchParams({});
        }
    }, [searchParams, setSearchParams, onRefresh]);

    const hasDiscordLinked = Boolean(user.discordId && !user.discordId.startsWith('local:'));
    const avatarOptions = buildAvatarOptions(user, characters);
    const currentAvatarUrl = resolveCurrentAvatar(avatarOptions, avatarIndex, user);

    const handleAvatarSelect = useCallback((url: string) => {
        const idx = avatarOptions.findIndex(o => o.url === url);
        if (idx >= 0) { setAvatarIndex(idx); localStorage.setItem(AVATAR_PREF_KEY, String(idx)); }
    }, [avatarOptions]);

    const handleLinkDiscord = () => {
        const token = localStorage.getItem('raid_ledger_token');
        if (!token) { toast.error('Please log in again to link Discord'); return; }
        window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;
    };

    return (
        <>
            <div className="bg-surface border border-edge-subtle rounded-xl p-4 mb-6">
                <div className="flex items-center gap-4">
                    <button type="button" onClick={() => setShowAvatarModal(true)} className="relative group flex-shrink-0" aria-label="Change avatar">
                        <img src={currentAvatarUrl} alt={user.username} className="w-12 h-12 rounded-full border-2 border-emerald-500/50 object-cover" onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
                        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </div>
                    </button>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-foreground truncate">{user.username}</span>
                            <RoleBadge role={user.role} />
                        </div>
                        <p className="text-sm text-muted truncate">Manage your profile and preferences</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                        <button type="button" onClick={hasDiscordLinked ? () => setShowDiscordModal(true) : handleLinkDiscord} className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${hasDiscordLinked ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'}`}>
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
                            {hasDiscordLinked ? 'Connected' : 'Link Discord'}
                        </button>
                        <button type="button" onClick={() => setShowAvatarModal(true)} className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-overlay/30 transition-colors" aria-label="Edit profile">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                    </div>
                </div>
            </div>
            <AvatarSelectorModal isOpen={showAvatarModal} onClose={() => setShowAvatarModal(false)} currentAvatarUrl={currentAvatarUrl} avatarOptions={avatarOptions} onSelect={handleAvatarSelect} customAvatarDisplayUrl={user.customAvatarUrl ? `${API_BASE_URL}${user.customAvatarUrl}` : null} onUpload={handleUpload} onRemoveCustom={handleRemoveCustomAvatar} isUploading={isUploading} uploadProgress={uploadProgress} />
            <DiscordDetailsModal isOpen={showDiscordModal} onClose={() => setShowDiscordModal(false)} username={user.username} discordId={user.discordId || ''} avatar={user.avatar || null} onRefresh={onRefresh} />
        </>
    );
}
