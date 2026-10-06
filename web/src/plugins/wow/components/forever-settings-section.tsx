/**
 * ROK-1717: the WoW Forever controls inside the Blizzard API integration card.
 *
 * Blizzard has not published the Forever namespace, so the admin sets its
 * prefix here (no deploy) and turns Forever Armory import on once it works.
 * The prefix is a form field saved with its button; the Armory switch applies
 * immediately with the saved prefix (design-system: a Switch is for settings
 * that apply at once).
 */
import { useId, useState, type FormEvent, type JSX } from 'react';
import { WowForeverNamespacePrefixSchema, type WowForeverConfigResponseDto } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { useForeverConfig } from '../hooks/use-forever-config';

type SaveFn = ReturnType<typeof useForeverConfig>['update']['mutateAsync'];

async function save(mutate: SaveFn, dto: Parameters<SaveFn>[0], success: string): Promise<void> {
    try {
        await mutate(dto);
        toast.success(success);
    } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save WoW Forever settings');
    }
}

function PrefixForm({ saved, mutate, pending }: { saved: WowForeverConfigResponseDto; mutate: SaveFn; pending: boolean }): JSX.Element {
    const [prefix, setPrefix] = useState(saved.namespacePrefix);
    const [error, setError] = useState<string | undefined>();
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        const parsed = WowForeverNamespacePrefixSchema.safeParse(prefix);
        if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Invalid prefix'); return; }
        setError(undefined);
        void save(mutate, { namespacePrefix: parsed.data, armoryImportEnabled: saved.armoryImportEnabled }, 'WoW Forever namespace saved');
    };
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
            <Field label="Namespace prefix" error={error}
                hint="Blizzard namespace without the static-/dynamic-/profile- part and region">
                <Input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="classicforever" fieldSize="lg" />
            </Field>
            <Button type="submit" variant="secondary" loading={pending} loadingLabel="Saving..." aria-label="Save Forever settings">
                Save
            </Button>
        </form>
    );
}

function ArmoryToggle({ saved, mutate, pending }: { saved: WowForeverConfigResponseDto; mutate: SaveFn; pending: boolean }): JSX.Element {
    const hintId = useId();
    const onChange = (next: boolean): void => {
        void save(mutate, { namespacePrefix: saved.namespacePrefix, armoryImportEnabled: next },
            next ? 'Armory import for WoW Forever turned on' : 'Armory import for WoW Forever turned off');
    };
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <p className="text-sm font-medium text-foreground">Armory import for WoW Forever</p>
                <p id={hintId} className="text-sm text-secondary">Offer “Import from Armory” for Forever characters.</p>
            </div>
            <Switch checked={saved.armoryImportEnabled} onChange={onChange} label="Armory import for WoW Forever"
                aria-describedby={hintId} disabled={pending} />
        </div>
    );
}

/** The admin "WoW Forever" section; renders nothing until the saved config has loaded. */
export function ForeverSettingsSection(): JSX.Element | null {
    const { config, update } = useForeverConfig();
    if (!config.data) return null;
    return (
        <section aria-labelledby="wow-forever-settings-heading" className="mt-6 pt-6 border-t border-edge space-y-4">
            <h3 id="wow-forever-settings-heading" className="text-base font-semibold text-foreground">WoW Forever</h3>
            <PrefixForm key={config.data.namespacePrefix} saved={config.data} mutate={update.mutateAsync} pending={update.isPending} />
            <ArmoryToggle saved={config.data} mutate={update.mutateAsync} pending={update.isPending} />
        </section>
    );
}
