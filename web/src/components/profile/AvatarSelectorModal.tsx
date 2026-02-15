import { AvatarUploadZone } from './AvatarUploadZone';

interface AvatarOption {
    url: string;
    label: string;
}

interface AvatarSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentAvatarUrl: string;
    avatarOptions: AvatarOption[];
    onSelect: (url: string) => void;
    /** Full URL for displaying the custom avatar */
    customAvatarDisplayUrl?: string | null;
    onUpload?: (file: File) => void;
    onRemoveCustom?: () => void;
    isUploading?: boolean;
    uploadProgress?: number;
}

/**
 * Modal for selecting primary avatar from available sources.
 * Shows upload zone at top (ROK-220) and a grid of existing avatars below.
 */
export function AvatarSelectorModal({
    isOpen,
    onClose,
    currentAvatarUrl,
    avatarOptions,
    onSelect,
    customAvatarDisplayUrl,
    onUpload,
    onRemoveCustom,
    isUploading = false,
    uploadProgress = 0,
}: AvatarSelectorModalProps) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="bg-surface border border-edge rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Choose Avatar</h3>
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-foreground transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Upload zone (ROK-220) */}
                {onUpload && onRemoveCustom && (
                    <div className="mb-4">
                        <AvatarUploadZone
                            onFileSelected={onUpload}
                            isUploading={isUploading}
                            uploadProgress={uploadProgress}
                            currentCustomUrl={customAvatarDisplayUrl ?? null}
                            onRemove={onRemoveCustom}
                        />
                    </div>
                )}

                {/* Divider */}
                {avatarOptions.length > 0 && (
                    <div className="flex items-center gap-3 mb-4">
                        <div className="flex-1 h-px bg-edge-subtle" />
                        <span className="text-xs text-dim">or select existing</span>
                        <div className="flex-1 h-px bg-edge-subtle" />
                    </div>
                )}

                {/* Avatar grid */}
                {avatarOptions.length === 0 && !onUpload ? (
                    <div className="text-center py-8 text-dim">
                        <p>No avatar options available.</p>
                        <p className="text-xs mt-1">Link accounts or add characters to get avatar options.</p>
                    </div>
                ) : avatarOptions.length > 0 ? (
                    <div className="avatar-selector-grid">
                        {avatarOptions.map((option) => (
                            <button
                                key={option.url}
                                type="button"
                                className={`avatar-selector-option ${currentAvatarUrl === option.url ? 'avatar-selector-option--selected' : ''
                                    }`}
                                onClick={() => onSelect(option.url)}
                                title={option.label}
                                aria-label={`Select avatar: ${option.label}`}
                            >
                                <img
                                    src={option.url}
                                    alt={option.label}
                                    onError={(e) => {
                                        e.currentTarget.src = '/default-avatar.svg';
                                    }}
                                />
                                <span className="avatar-selector-option__label">{option.label}</span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {/* Footer */}
                <div className="mt-4 pt-3 border-t border-edge-subtle flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-secondary hover:text-foreground transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
