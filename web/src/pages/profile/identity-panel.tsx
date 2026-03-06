import type { JSX } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth, isImpersonating } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useDiscordLink } from '../../hooks/use-discord-link';
import { useSteamLink } from '../../hooks/use-steam-link';
import { isDiscordLinked, resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { toast } from '../../lib/toast';
import { AvatarSelectorModal } from '../../components/profile/AvatarSelectorModal';
import { Modal } from '../../components/ui/modal';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { getMyPreferences, updatePreference, deleteMyAccount } from '../../lib/api-client';
import { API_BASE_URL } from '../../lib/config';
import { buildAvatarOptions } from './identity-helpers';
import { UserIdentityCard, DiscordLinkCta, SteamSection, AutoHeartToggle } from './identity-sections';

/**
 * Consolidated Identity panel (ROK-359).
 * Merges the old My Profile, Discord, Avatar, and Account panels into a single page.
 */
// eslint-disable-next-line max-lines-per-function
export function IdentityPanel(): JSX.Element | null {
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
    const { linkSteam, steamStatus, unlinkSteam, syncLibrary } = useSteamLink();

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
    const avatarOptions = useMemo(() => (user ? buildAvatarOptions(user, characters) : []), [user, characters]);
    const [optimisticUrl, setOptimisticUrl] = useState<string | null>(null);

    const handleAvatarSelect = useCallback((url: string) => {
        const option = avatarOptions.find(o => o.url === url);
        if (!option) return;
        setOptimisticUrl(url);
        const pref = option.type === 'character'
            ? { type: option.type, characterName: option.characterName }
            : { type: option.type };
        updatePreference('avatarPreference', pref)
            .then(() => { queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); setOptimisticUrl(null); })
            .catch(() => { toast.error('Failed to save avatar preference'); setOptimisticUrl(null); });
    }, [avatarOptions, queryClient]);

    const expectedName = user?.displayName || user?.username || '';
    const deleteMutation = useMutation({
        mutationFn: () => deleteMyAccount(confirmName),
        onSuccess: () => { logout(); toast.success('Your account has been deleted'); navigate('/login', { replace: true }); },
        onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to delete account'); },
    });
    const isConfirmValid = confirmName === expectedName;
    const hasDiscordLinked = isDiscordLinked(user?.discordId ?? null);

    const { data: prefs } = useQuery({
        queryKey: ['user-preferences'], queryFn: getMyPreferences,
        enabled: isAuthenticated && hasDiscordLinked, staleTime: Infinity,
    });
    const autoHeartEnabled = prefs?.autoHeartGames !== false;
    const autoHeartMutation = useMutation({
        mutationFn: (enabled: boolean) => updatePreference('autoHeartGames', enabled),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-preferences'] }); },
        onError: () => { toast.error('Failed to update auto-heart preference'); },
    });

    if (!user) return null;

    const showDangerZone = !isImpersonating();
    const avatarUser = toAvatarUser({ ...user, characters });
    const resolved = resolveAvatar(avatarUser);
    const resolvedAvatarUrl = resolved.url ?? '/default-avatar.svg';
    const currentAvatarUrl = optimisticUrl ?? resolvedAvatarUrl;
    const showDiscord = systemStatus?.discordConfigured;

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">Identity</h2>
                <p className="text-sm text-muted mb-6">Your profile identity and linked accounts. Click your avatar to change it.</p>
                <UserIdentityCard user={user} currentAvatarUrl={currentAvatarUrl} onOpenAvatarModal={() => setShowAvatarModal(true)} />
                {showDiscord && !hasDiscordLinked && <DiscordLinkCta onLink={handleLinkDiscord} />}
                <SteamSection steamStatus={steamStatus} linkSteam={linkSteam} unlinkSteam={unlinkSteam} syncLibrary={syncLibrary} />
                {hasDiscordLinked && <AutoHeartToggle enabled={autoHeartEnabled} onToggle={(v) => autoHeartMutation.mutate(v)} isPending={autoHeartMutation.isPending} />}
            </div>

            {showDangerZone && <DangerZone onOpenDeleteModal={() => setShowDeleteModal(true)} />}

            <AvatarSelectorModal isOpen={showAvatarModal} onClose={() => setShowAvatarModal(false)}
                currentAvatarUrl={currentAvatarUrl} avatarOptions={avatarOptions} onSelect={handleAvatarSelect}
                customAvatarDisplayUrl={user.customAvatarUrl ? `${API_BASE_URL}${user.customAvatarUrl}` : null}
                onUpload={handleUpload} onRemoveCustom={handleRemoveCustomAvatar}
                isUploading={isUploading} uploadProgress={uploadProgress} />

            <DeleteAccountModal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setConfirmName(''); }}
                expectedName={expectedName} confirmName={confirmName} onConfirmNameChange={setConfirmName}
                isConfirmValid={isConfirmValid} onDelete={() => deleteMutation.mutate()} isPending={deleteMutation.isPending} />
        </div>
    );
}

/** Danger zone section with delete account button */
function DangerZone({ onOpenDeleteModal }: { onOpenDeleteModal: () => void }): JSX.Element {
    return (
        <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-red-400 mb-1">Danger Zone</h2>
            <p className="text-sm text-muted mb-6">Irreversible actions that permanently affect your account.</p>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">Delete My Account</h3>
                        <p className="text-sm text-muted mt-1">Permanently delete your account, characters, event signups, and all associated data. This cannot be undone.</p>
                    </div>
                    <button onClick={onOpenDeleteModal} className="flex-shrink-0 px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm rounded-lg transition-colors">
                        Delete My Account
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Delete account confirmation modal */
// eslint-disable-next-line max-lines-per-function
function DeleteAccountModal({ isOpen, onClose, expectedName, confirmName, onConfirmNameChange, isConfirmValid, onDelete, isPending }: {
    isOpen: boolean; onClose: () => void; expectedName: string; confirmName: string;
    onConfirmNameChange: (v: string) => void; isConfirmValid: boolean; onDelete: () => void; isPending: boolean;
}): JSX.Element {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Delete Account">
            <div className="space-y-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-sm text-red-400 font-medium mb-1">This action is permanent and cannot be undone.</p>
                    <p className="text-sm text-red-400/80">This will permanently delete your account, characters, event signups, and all associated data.</p>
                </div>
                <div>
                    <label htmlFor="confirm-name" className="block text-sm text-secondary mb-1.5">
                        Type <strong className="text-foreground">{expectedName}</strong> to confirm
                    </label>
                    <input id="confirm-name" type="text" value={confirmName} onChange={(e) => onConfirmNameChange(e.target.value)}
                        placeholder={expectedName} autoComplete="off"
                        className="w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors">Cancel</button>
                    <button onClick={onDelete} disabled={!isConfirmValid || isPending}
                        className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                        {isPending ? 'Deleting...' : 'Delete My Account'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
