/**
 * ROK-1435 (L5): admin card for the weekly Discord digest — master toggle, the
 * day + hour it posts (community timezone), and a dedicated channel that falls
 * back to the default notification channel. Every control saves on change,
 * like the sibling LFG board and channel pickers.
 */
import { useRef } from 'react';
import type { WeeklyDigestSettings } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import { ChannelSelector } from '../../components/admin/channel-selector';
import { useWeeklyDigestSettings } from '../../hooks/admin/use-weekly-digest-settings';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SELECT_CLASS =
    'w-full min-h-[44px] bg-panel border border-edge rounded-md px-3 py-2 text-base text-foreground ' +
    'focus:outline-none focus:ring-2 focus:ring-success/50 disabled:opacity-50';
// TODO(ROK-1612 Switch): swap this hand-rolled track for the shared
// `components/ui/switch.tsx` once ROK-1612 lands. Token classes only, so every
// theme repaints it (success fill, surface knob).
const TOGGLE_TRACK =
    "w-11 h-6 bg-dim rounded-full peer peer-checked:bg-success peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-success/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full";

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Query + mutation wiring: every change PUTs the full settings object. A save
 * builds on the newest pending payload, not the (possibly stale) query snapshot,
 * so a second edit made before the first settles never drops the first (Codex P2).
 */
function useDigestForm() {
    const { status, channels, update } = useWeeklyDigestSettings();
    const current = status.data;
    const pending = useRef<WeeklyDigestSettings | null>(null);
    const save = (patch: Partial<WeeklyDigestSettings>): Promise<void> => {
        if (!current) return Promise.resolve();
        const base: WeeklyDigestSettings = pending.current ?? {
            enabled: current.enabled, channelId: current.channelId, day: current.day, hour: current.hour,
        };
        const next = { ...base, ...patch };
        pending.current = next;
        return update.mutateAsync(next)
            .then(() => { toast.success('Weekly digest settings saved'); })
            .catch(() => { toast.error('Failed to update weekly digest settings'); })
            .finally(() => { if (pending.current === next) pending.current = null; });
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
            <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" aria-label="Enable weekly digest" checked={checked}
                    onChange={(e) => onToggle(e.target.checked)} disabled={disabled} className="sr-only peer" />
                <div className={TOGGLE_TRACK} />
            </label>
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
                <label className="block text-sm font-medium text-secondary">Day
                    <select aria-label="Digest day" value={day} disabled={disabled} className={`${SELECT_CLASS} mt-1.5`}
                        onChange={(e) => onSave({ day: Number(e.target.value) as WeeklyDigestSettings['day'] })}>
                        {DAYS.map((name, i) => <option key={name} value={i}>{name}</option>)}
                    </select>
                </label>
                <label className="block text-sm font-medium text-secondary">Hour
                    <select aria-label="Digest hour" value={hour} disabled={disabled} className={`${SELECT_CLASS} mt-1.5`}
                        onChange={(e) => onSave({ hour: Number(e.target.value) })}>
                        {HOURS.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                    </select>
                </label>
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
