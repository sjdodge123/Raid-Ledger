import { useAdminSettings } from '../../hooks/use-admin-settings';
import { toast } from '../../lib/toast';

/**
 * ROK-1352: Admin controls for ephemeral voice channels — global toggle plus
 * category picker + buffer/idle inputs (shown only when enabled). Extracted to
 * its own file so `discord-features-page.tsx` stays small.
 */
export function EphemeralVoiceSection() {
    const {
        ephemeralVoiceConfig,
        ephemeralVoiceCategories,
        updateEphemeralVoice,
    } = useAdminSettings();
    const cfg = ephemeralVoiceConfig.data;
    const enabled = cfg?.enabled ?? false;

    const save = (patch: Record<string, unknown>, msg: string) =>
        updateEphemeralVoice.mutate(patch, {
            onSuccess: () => toast.success(msg),
            onError: () => toast.error('Failed to update ephemeral voice settings'),
        });

    return (
        <div className="bg-surface rounded-xl border border-edge p-6 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-foreground">Ephemeral Voice Channels</h3>
                    <p className="text-sm text-muted mt-1">
                        Create a temporary voice channel before an event and delete it after it sits empty.
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        aria-label="Enable ephemeral voice channels"
                        checked={enabled}
                        onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Ephemeral voice enabled' : 'Ephemeral voice disabled')}
                        disabled={updateEphemeralVoice.isPending}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-dim rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
            </div>
            {enabled && (
                <EphemeralVoiceConfigFields
                    categoryId={cfg?.categoryId ?? null}
                    createBufferMinutes={cfg?.createBufferMinutes ?? 30}
                    idleMinutes={cfg?.idleMinutes ?? 30}
                    categories={ephemeralVoiceCategories.data ?? []}
                    onSave={save}
                />
            )}
        </div>
    );
}

interface FieldsProps {
    categoryId: string | null;
    createBufferMinutes: number;
    idleMinutes: number;
    categories: { id: string; name: string }[];
    onSave: (patch: Record<string, unknown>, msg: string) => void;
}

function EphemeralVoiceConfigFields(props: FieldsProps) {
    return (
        <div className="grid gap-4 sm:grid-cols-3 pt-2 border-t border-edge">
            <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Parent category</span>
                <select
                    className="bg-overlay border border-edge rounded px-2 py-1 text-foreground"
                    value={props.categoryId ?? ''}
                    onChange={(e) => props.onSave({ categoryId: e.target.value || null }, 'Category updated')}
                >
                    <option value="">{props.categories.length ? 'Guild root' : 'No categories'}</option>
                    {props.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </label>
            <MinutesInput
                label="Create buffer (min)"
                value={props.createBufferMinutes}
                onCommit={(n) => props.onSave({ createBufferMinutes: n }, 'Create buffer updated')}
            />
            <MinutesInput
                label="Idle window (min)"
                value={props.idleMinutes}
                onCommit={(n) => props.onSave({ idleMinutes: n }, 'Idle window updated')}
            />
        </div>
    );
}

function MinutesInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
    return (
        <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{label}</span>
            <input
                type="number"
                min={0}
                defaultValue={value}
                aria-label={label}
                className="bg-overlay border border-edge rounded px-2 py-1 text-foreground"
                onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
                }}
            />
        </label>
    );
}
