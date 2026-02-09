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
}

/**
 * Modal for selecting primary avatar from available sources.
 * Shows a grid of avatar options (Discord, character portraits).
 * Selected avatar stored in localStorage as MVP.
 */
export function AvatarSelectorModal({
    isOpen,
    onClose,
    currentAvatarUrl,
    avatarOptions,
    onSelect,
}: AvatarSelectorModalProps) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">Choose Avatar</h3>
                    <button
                        onClick={onClose}
                        className="p-1 text-slate-400 hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <p className="text-sm text-slate-400 mb-4">
                    Select your primary avatar from linked accounts and character portraits.
                </p>

                {/* Avatar grid */}
                {avatarOptions.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                        <p>No avatar options available.</p>
                        <p className="text-xs mt-1">Link accounts or add characters to get avatar options.</p>
                    </div>
                ) : (
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
                )}

                {/* Footer */}
                <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
