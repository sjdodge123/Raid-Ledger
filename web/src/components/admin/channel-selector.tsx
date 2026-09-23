/**
 * Discord text/voice channel picker shared by the admin Discord pages
 * (default, voice and lineup channels on Channels; the weekly digest on
 * Features). Saves on change. Built on the `Field` + `Select` primitives
 * (ROK-1646), so the label, hint and control are wired by `Field`.
 *
 * `clearLabel` makes the empty option selectable (it then calls `onChange('')`)
 * for settings that fall back to another channel when unset. `framed={false}`
 * drops the card chrome so the control can sit inside another section's card.
 */
import { Field } from '../ui/field';
import { Select } from '../ui/select';

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
        <Field id={id} label={label} hint={hint}
            className={framed ? 'bg-surface border border-edge-subtle rounded-xl p-6' : undefined}>
            <Select fieldSize="lg" value={value} disabled={isPending || disabled}
                onChange={(e) => { void handleChange(e.target.value); }}>
                <option value="" disabled={!clearLabel}>{clearLabel ?? 'Select a channel...'}</option>
                {channels.map((ch) => <option key={ch.id} value={ch.id}>{prefix}{ch.name}</option>)}
            </Select>
        </Field>
    );
}
