import { useCallback } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { AvatarUploadZone } from '../profile/AvatarUploadZone';
import { AppearancePanel } from '../../pages/profile/appearance-panel';

interface AvatarThemeStepProps {
    onComplete: () => void;
    onBack: () => void;
    isCompleting: boolean;
}

/**
 * Step 6: Avatar & Theme (ROK-219 redesign).
 * Replaces the old DoneStep. Embeds avatar upload and appearance settings.
 */
export function AvatarThemeStep({ onComplete, onBack, isCompleting }: AvatarThemeStepProps) {
    const { user, refetch } = useAuth();
    const { upload, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();

    const handleFileSelected = useCallback(
        (file: File) => {
            upload(file, {
                onSuccess: () => refetch(),
            });
        },
        [upload, refetch],
    );

    const handleRemoveAvatar = useCallback(() => {
        deleteAvatar(undefined, {
            onSuccess: () => refetch(),
        });
    }, [deleteAvatar, refetch]);

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-foreground">Personalize Your Profile</h2>
                <p className="text-muted mt-2">
                    Upload an avatar and choose your theme. You can change these anytime.
                </p>
            </div>

            {/* Avatar section */}
            <div className="max-w-sm mx-auto">
                <AvatarUploadZone
                    onFileSelected={handleFileSelected}
                    isUploading={isUploading}
                    uploadProgress={uploadProgress}
                    currentCustomUrl={user?.customAvatarUrl ?? null}
                    onRemove={handleRemoveAvatar}
                />
            </div>

            {/* Theme section */}
            <div className="max-w-lg mx-auto">
                <AppearancePanel />
            </div>

            {/* Navigation */}
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={onComplete}
                    disabled={isCompleting}
                    className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-semibold rounded-lg transition-colors text-sm"
                >
                    {isCompleting ? 'Finishing...' : 'Finish Setup'}
                </button>
            </div>
        </div>
    );
}
