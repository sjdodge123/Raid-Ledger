/**
 * Discord text/voice channel `<select>` shared by the admin Discord pages
 * (default, voice and lineup channels on Channels; the weekly digest on
 * Features). Saves on change.
 *
 * `clearLabel` makes the empty option selectable (it then calls `onChange('')`)
 * for settings that fall back to another channel when unset. `framed={false}`
 * drops the card chrome so the control can sit inside another section's card.
 */
export interface ChannelSelectorProps {
    id: string;
    label: string;
    channels: { id: string; name: string }[];
    value: string;
    isPending: boolean;
    prefix: string;
    hint: string;
    onChange: (v: string) => Promise<void>;
    onError: () => void;
    clearLabel?: string;
    disabled?: boolean;
    framed?: boolean;
}

export function ChannelSelector(props: ChannelSelectorProps) {
    const { id, label, channels, value, isPending, prefix, hint, onChange, onError, clearLabel, disabled, framed = true } = props;
    const handleChange = async (next: string) => {
        if (!next && !clearLabel) return;
        try { await onChange(next); } catch { onError(); }
    };
    return (
        <div className={framed ? 'bg-surface border border-edge-subtle rounded-xl p-6' : undefined}>
            <label htmlFor={id} className="block text-sm font-medium text-secondary mb-1.5">{label}</label>
            <select id={id} value={value} disabled={isPending || disabled}
                onChange={(e) => { void handleChange(e.target.value); }}
                className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50">
                <option value="" disabled={!clearLabel}>{clearLabel ?? 'Select a channel...'}</option>
                {channels.map((ch) => <option key={ch.id} value={ch.id}>{prefix}{ch.name}</option>)}
            </select>
            <p className="text-xs text-secondary mt-1.5">{hint}</p>
        </div>
    );
}
