interface PowerCoreAvatarProps {
    avatarUrl: string;
    username: string;
    isAdmin?: boolean;
    onEdit: () => void;
    onCyclePrev: () => void;
    onCycleNext: () => void;
    /** Whether there are multiple avatar options to cycle through */
    hasMultipleAvatars: boolean;
}

/**
 * Center hub of the Integration Hub — the "Power Core" avatar.
 * Displays user avatar with animated glow ring, edit overlay,
 * and navigation arrows for cycling through avatar options.
 */
export function PowerCoreAvatar({
    avatarUrl,
    username,
    isAdmin,
    onEdit,
    onCyclePrev,
    onCycleNext,
    hasMultipleAvatars,
}: PowerCoreAvatarProps) {
    return (
        <div className="power-core">
            {/* Avatar with glow ring */}
            <div className="power-core__ring">
                <img
                    src={avatarUrl}
                    alt={username}
                    className="power-core__avatar"
                    onError={(e) => {
                        e.currentTarget.src = '/default-avatar.svg';
                    }}
                />

                {/* Edit overlay */}
                <button
                    className="power-core__edit"
                    onClick={onEdit}
                    aria-label="Change avatar"
                    title="Change avatar"
                >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                    </svg>
                </button>
            </div>

            {/* Username + badges */}
            <div className="power-core__username">
                {username}
                {isAdmin && (
                    <span className="ml-2 inline-block px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
                        Admin
                    </span>
                )}
            </div>

            {/* Avatar cycle nav */}
            {hasMultipleAvatars && (
                <div className="power-core__nav">
                    <button
                        className="power-core__nav-btn"
                        onClick={onCyclePrev}
                        aria-label="Previous avatar"
                    >
                        ‹
                    </button>
                    <span className="text-xs text-slate-500">Change Avatar</span>
                    <button
                        className="power-core__nav-btn"
                        onClick={onCycleNext}
                        aria-label="Next avatar"
                    >
                        ›
                    </button>
                </div>
            )}
        </div>
    );
}
