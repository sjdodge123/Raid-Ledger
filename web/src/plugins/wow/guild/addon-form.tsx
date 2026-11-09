/**
 * ROK-1786 — the editor's "Add addon" form (paste a link; the name + source
 * preview is client-side only, the server parses for real) and the shared
 * note / required / flavor / folder-name fields the inline row editor reuses
 * (prototype `AddonForm.tsx`).
 */
import { useState, type JSX } from 'react';
import {
    GUILD_ADDON_FLAVORS, GUILD_ADDON_FOLDER_NAME_MAX, GUILD_ADDON_NOTE_MAX, GUILD_URL_MAX, type GuildAddonFlavor,
} from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { RadioGroup } from '../../../components/ui/radio-group';
import { Select } from '../../../components/ui/select';
import { previewAddonUrl } from './addon-url';
import { pickFlavor } from './addon-flavor-default';
import { FLAVOR_LABEL, SOURCE_LABEL, type AddonDetails } from './addon-view';
import { Pill } from '../../../components/hub/hub-bits';

const REQUIRED_OPTIONS = [
    { value: 'required', label: 'Required' },
    { value: 'optional', label: 'Optional' },
] as const;

const FLAVOR_OPTIONS = ['any', ...GUILD_ADDON_FLAVORS] as const;

export function AddonDetailFields({ value, onChange }: { value: AddonDetails; onChange: (next: AddonDetails) => void }): JSX.Element {
    const onFlavor = (v: string): void => {
        const flavor = GUILD_ADDON_FLAVORS.find((f) => f === v) ?? null;
        onChange({ ...value, flavor });
    };
    return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)] md:items-end">
            <Field label="Note" hint="Shown to members under the addon name.">
                <Input value={value.note} maxLength={GUILD_ADDON_NOTE_MAX} onChange={(e) => onChange({ ...value, note: e.target.value })} />
            </Field>
            <RadioGroup label="Required or optional" hideLabel appearance="segmented" options={REQUIRED_OPTIONS}
                value={value.requirement} onChange={(v) => onChange({ ...value, requirement: v })} />
            <Field label="Flavor">
                <Select value={value.flavor ?? 'any'} onChange={(e) => onFlavor(e.target.value)}>
                    {FLAVOR_OPTIONS.map((f) => <option key={f} value={f}>{FLAVOR_LABEL[f]}</option>)}
                </Select>
            </Field>
            <div className="md:col-span-3">
                <Field label="Addon folder name" hint="As it appears in Interface/AddOns — used to show who has it installed.">
                    <Input value={value.folderName} maxLength={GUILD_ADDON_FOLDER_NAME_MAX} placeholder="Optional"
                        onChange={(e) => onChange({ ...value, folderName: e.target.value })} />
                </Field>
            </div>
        </div>
    );
}

const EMPTY: AddonDetails = { note: '', requirement: 'optional', flavor: null, folderName: '' };

export interface NewAddon extends AddonDetails { url: string }

/**
 * The form's details with the Flavor pre-set to `defaultFlavor` (ROK-2114)
 * until the editor picks one; a reset returns to it. `undefined` choice =
 * untouched, so a default that arrives late still lands.
 */
function useAddonDetails(defaultFlavor: GuildAddonFlavor | null) {
    const [details, setDetails] = useState<AddonDetails>(EMPTY);
    const [flavorChoice, setFlavorChoice] = useState<GuildAddonFlavor | null | undefined>(undefined);
    const shown: AddonDetails = { ...details, flavor: pickFlavor(flavorChoice, defaultFlavor, null) };
    const onChange = (next: AddonDetails): void => {
        if (next.flavor !== shown.flavor) setFlavorChoice(next.flavor);
        setDetails(next);
    };
    const reset = (): void => { setDetails(EMPTY); setFlavorChoice(undefined); };
    return { details: shown, onChange, reset };
}

/**
 * `failure` is the server's message for the last failed add (e.g. a 400 or 409).
 * `defaultFlavor` is the guild's own flavor (ROK-2114); null = Any flavor.
 */
export function AddAddonForm({ onAdd, pending, failure, defaultFlavor = null }: {
    onAdd: (addon: NewAddon, reset: () => void) => void; pending: boolean; failure: string | null; defaultFlavor?: GuildAddonFlavor | null;
}): JSX.Element {
    const [url, setUrl] = useState('');
    const form = useAddonDetails(defaultFlavor);
    const preview = url.trim() ? previewAddonUrl(url) : null;
    const parsed = preview?.ok ? preview.addon : null;
    const error = preview && !preview.ok ? preview.error : undefined;
    const reset = (): void => { setUrl(''); form.reset(); };
    return (
        <div className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-3" data-testid="guild-addon-form">
            <Field label="Addon link" error={error ?? (failure ? `Couldn’t add that addon. ${failure}` : undefined)}
                hint="CurseForge, Wago or GitHub. The name comes from the link.">
                <Input type="url" inputMode="url" value={url} maxLength={GUILD_URL_MAX} placeholder="https://www.curseforge.com/wow/addons/…"
                    onChange={(e) => setUrl(e.target.value)} />
            </Field>
            {parsed && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-secondary" data-testid="guild-addon-preview">
                    Adding <span className="font-semibold text-foreground">{parsed.name}</span><Pill>{SOURCE_LABEL[parsed.source]}</Pill>
                </p>
            )}
            <AddonDetailFields value={form.details} onChange={form.onChange} />
            <div className="flex justify-end">
                <Button onClick={() => parsed && onAdd({ url: url.trim(), ...form.details }, reset)} disabled={!parsed} loading={pending}
                    data-testid="guild-addon-add">Add addon</Button>
            </div>
        </div>
    );
}
