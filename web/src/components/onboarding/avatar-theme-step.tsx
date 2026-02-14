import { useCallback } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { AvatarUploadZone } from '../profile/AvatarUploadZone';
import { AppearancePanel } from '../../pages/profile/appearance-panel';
import { TimezoneSection } from '../profile/TimezoneSection';


/**
 * Final Step: Personalize Your Profile (ROK-219 redesign / ROK-312 merge).
 * Combines timezone, avatar upload, and appearance settings into one step.
 * ROK-312: Merged TimezoneStep into this step, added reminder note.
 */
export function AvatarThemeStep() {
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
                    Upload an avatar, set your timezone, and choose your theme.
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

            {/* Timezone section */}
            <div className="max-w-md mx-auto">
                <TimezoneSection />
            </div>

            {/* Theme section */}
            <div className="max-w-lg mx-auto">
                <AppearancePanel />
            </div>

            {/* Reminder note */}
            <p className="text-center text-sm text-muted">
                You can always re-run this setup or change these settings from your profile page.
            </p>

        </div>
    );
}
