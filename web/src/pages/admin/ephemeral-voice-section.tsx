import { useAdminSettings } from '../../hooks/use-admin-settings';
import { toast } from '../../lib/toast';
import { Switch } from '../../components/ui/switch';
import { Checkbox } from '../../components/ui/checkbox';
import { Field } from '../../components/ui/field';
import { Select } from '../../components/ui/select';
import { Input } from '../../components/ui/input';

type SaveFn = (patch: Record<string, unknown>, msg: string) => void;

/**
 * ROK-1352: Admin controls for ephemeral voice channels — global toggle plus
 * category picker + buffer/idle inputs (shown only when enabled). Extracted to
 * its own file so `discord-features-page.tsx` stays small.
 * ROK-1652: the shared Switch, Checkbox, Field, Select and Input.
 */
export function EphemeralVoiceSection() {
    const { ephemeralVoiceConfig, ephemeralVoiceCategories, updateEphemeralVoice } = useAdminSettings();
    const cfg = ephemeralVoiceConfig.data;
    const enabled = cfg?.enabled ?? false;

    const save: SaveFn = (patch, msg) =>
        updateEphemeralVoice.mutate(patch, {
            onSuccess: () => toast.success(msg),
            onError: () => toast.error('Failed to update ephemeral voice settings'),
        });

    return (
        <div className="bg-surface rounded-xl border border-edge p-6 space-y-4">
            <EphemeralVoiceHeader enabled={enabled} pending={updateEphemeralVoice.isPending} onSave={save} />
            {enabled && (
                <>
                    <ForceEphemeralToggle forced={cfg?.forced ?? false} onSave={save} />
                    <EphemeralVoiceConfigFields
                        categoryId={cfg?.categoryId ?? null}
                        createBufferMinutes={cfg?.createBufferMinutes ?? 30}
                        idleMinutes={cfg?.idleMinutes ?? 30}
                        categories={ephemeralVoiceCategories.data ?? []}
                        onSave={save}
                    />
                </>
            )}
        </div>
    );
}

/** Title, blurb and the master on/off switch. */
function EphemeralVoiceHeader({ enabled, pending, onSave }: { enabled: boolean; pending: boolean; onSave: SaveFn }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <h3 className="text-base font-semibold text-foreground">Ephemeral Voice Channels</h3>
                <p className="text-sm text-muted mt-1">
                    Create a temporary voice channel before an event and delete it after it sits empty.
                </p>
            </div>
            <Switch
                label="Enable ephemeral voice channels"
                checked={enabled}
                disabled={pending}
                onChange={(on) => onSave({ enabled: on }, on ? 'Ephemeral voice enabled' : 'Ephemeral voice disabled')}
            />
        </div>
    );
}

/** ROK-1352: force-ephemeral — every event gets a channel; never reuse static. */
function ForceEphemeralToggle({ forced, onSave }: { forced: boolean; onSave: SaveFn }) {
    return (
        <div className="pt-2 border-t border-edge">
            <Checkbox
                label="Always create a temporary channel for every event"
                description="Raid Ledger never points events at existing/static voice channels."
                checked={forced}
                onChange={(e) =>
                    onSave(
                        { forced: e.target.checked },
                        e.target.checked ? 'Force-ephemeral enabled' : 'Force-ephemeral disabled',
                    )
                }
            />
        </div>
    );
}

interface FieldsProps {
    categoryId: string | null;
    createBufferMinutes: number;
    idleMinutes: number;
    categories: { id: string; name: string }[];
    onSave: SaveFn;
}

function EphemeralVoiceConfigFields(props: FieldsProps) {
    return (
        <div className="grid gap-4 sm:grid-cols-3 pt-2 border-t border-edge">
            <Field label="Parent category">
                <Select
                    fieldSize="sm"
                    value={props.categoryId ?? ''}
                    onChange={(e) => props.onSave({ categoryId: e.target.value || null }, 'Category updated')}
                >
                    <option value="">{props.categories.length ? 'Guild root' : 'No categories'}</option>
                    {props.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </Select>
            </Field>
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

/** Uncontrolled minutes box: commits a changed, non-negative number on blur. */
function MinutesInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
    return (
        <Field label={label}>
            <Input
                type="number"
                fieldSize="sm"
                min={0}
                defaultValue={value}
                onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
                }}
            />
        </Field>
    );
}
