/**
 * ROK-1435 (L5): admin card for the weekly Discord digest — master toggle, the
 * day + hour it posts (community timezone), and a dedicated channel that falls
 * back to the default notification channel. Every control saves on change,
 * like the sibling LFG board and channel pickers.
 */
import type { WeeklyDigestSettings } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import { ChannelSelector } from '../../components/admin/channel-selector';
import { Field } from '../../components/ui/field';
import { Select } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { useWeeklyDigestSettings } from '../../hooks/admin/use-weekly-digest-settings';
import { useSerializedSave } from './use-serialized-save';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Query + mutation wiring: every change PUTs the full settings object. Saves
 * run one at a time and each builds on the newest unsaved edit, so neither a
 * quick second edit nor an out-of-order response can drop an edit (Codex P2).
 */
function useDigestForm() {
    const { status, channels, update } = useWeeklyDigestSettings();
    const current = status.data;
    const enqueue = useSerializedSave<WeeklyDigestSettings>((payload) => update.mutateAsync(payload)
        .then(() => { toast.success('Weekly digest settings saved'); return true; })
        .catch(() => { toast.error('Failed to update weekly digest settings'); return false; }));
    const save = (patch: Partial<WeeklyDigestSettings>): Promise<void> => {
        if (!current) return Promise.resolve();
        const { enabled, channelId, day, hour } = current;
        return enqueue({ enabled, channelId, day, hour }, patch);
    };
    return { status, current, channels: channels.data ?? [], isPending: update.isPending, save };
}

function Header({ checked, disabled, onToggle }: { checked: boolean; disabled: boolean; onToggle: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <h3 className="text-base font-semibold text-foreground">Weekly digest</h3>
                <p className="text-sm text-muted mt-1">
                    Once a week the bot posts a recap: what the community played, events run, deals and open LFG groups.
                </p>
            </div>
            <Switch label="Enable weekly digest" checked={checked} onChange={onToggle} disabled={disabled} />
        </div>
    );
}

function SlotPicker({ day, hour, timezone, disabled, onSave }: {
    day: number; hour: number; timezone: string; disabled: boolean;
    onSave: (patch: Partial<WeeklyDigestSettings>) => void;
}) {
    return (
        <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Day">
                    <Select aria-label="Digest day" value={day} disabled={disabled}
                        onChange={(e) => onSave({ day: Number(e.target.value) as WeeklyDigestSettings['day'] })}>
                        {DAYS.map((name, i) => <option key={name} value={i}>{name}</option>)}
                    </Select>
                </Field>
                <Field label="Hour">
                    <Select aria-label="Digest hour" value={hour} disabled={disabled}
                        onChange={(e) => onSave({ hour: Number(e.target.value) })}>
                        {HOURS.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                    </Select>
                </Field>
            </div>
            <p className="text-xs text-secondary mt-1.5" data-testid="weekly-digest-timezone">
                Times are in the community timezone ({timezone}).
            </p>
        </div>
    );
}

/** Weekly digest card on the Discord Features page. */
export function WeeklyDigestSection(): React.ReactElement {
    const { status, current, channels, isPending, save } = useDigestForm();
    const locked = isPending || !current;
    const inactive = locked || !current?.enabled;

    return (
        <div className="bg-surface rounded-xl border border-edge p-6" data-testid="weekly-digest-section">
            <Header checked={current?.enabled ?? false} disabled={locked} onToggle={(v) => { void save({ enabled: v }); }} />
            {status.isError && (
                <p role="alert" className="mt-4 text-sm text-danger">
                    Couldn&apos;t load the weekly digest settings. Reload the page to try again.
                </p>
            )}
            {current && (
                <div className="mt-4 space-y-4">
                    <SlotPicker day={current.day} hour={current.hour} timezone={current.timezone}
                        disabled={inactive} onSave={(p) => { void save(p); }} />
                    <ChannelSelector id="weeklyDigestChannel" label="Channel" channels={channels} framed={false}
                        value={current.channelId ?? ''} isPending={isPending} disabled={inactive} prefix="#"
                        clearLabel="Default notification channel"
                        hint="Falls back to the default notification channel when none is picked."
                        onChange={(v) => save({ channelId: v || null })} onError={() => undefined} />
                </div>
            )}
        </div>
    );
}
