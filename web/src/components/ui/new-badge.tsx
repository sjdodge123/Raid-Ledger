interface NewBadgeProps {
    visible: boolean;
}

export function NewBadge({ visible }: NewBadgeProps) {
    if (!visible) return null;

    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            NEW
        </span>
    );
}
