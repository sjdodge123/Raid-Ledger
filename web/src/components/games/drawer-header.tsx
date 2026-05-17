interface DrawerHeaderProps {
    title: string;
    onClose: () => void;
}

export function DrawerHeader({ title, onClose }: DrawerHeaderProps) {
    return (
        <div className="flex items-center justify-between p-4 border-b border-edge-subtle sticky top-0 bg-surface z-10">
            <h2 className="text-lg font-semibold text-foreground truncate pr-3">{title}</h2>
            <button
                type="button"
                onClick={onClose}
                data-testid="game-research-drawer-close"
                aria-label="Close"
                className="p-2 text-muted hover:text-foreground rounded-lg hover:bg-panel transition-colors"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}
