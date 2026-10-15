/**
 * ROK-1786 — the editor's "Add addon" form (paste a link; the name + source
 * preview is client-side only, the server parses for real) and the shared
 * note / required / flavor fields the inline row editor reuses
 * (prototype `AddonForm.tsx`).
 */
import { useState, type JSX } from 'react';
import { GUILD_ADDON_FLAVORS, GUILD_ADDON_NOTE_MAX, GUILD_URL_MAX } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { RadioGroup } from '../../../components/ui/radio-group';
import { Select } from '../../../components/ui/select';
import { parseAddonUrl } from './addon-url';
import type { AddonDetails } from './addon-view';
import { Pill } from './guild-bits';
import { FLAVOR_LABEL, SOURCE_LABEL } from './guild-content.helpers';

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
        </div>
    );
}

const EMPTY: AddonDetails = { note: '', requirement: 'optional', flavor: null };

export interface NewAddon extends AddonDetails { url: string }

export function AddAddonForm({ onAdd, pending, failed }: {
    onAdd: (addon: NewAddon, reset: () => void) => void; pending: boolean; failed: boolean;
}): JSX.Element {
    const [url, setUrl] = useState('');
    const [details, setDetails] = useState<AddonDetails>(EMPTY);
    const parsed = url.trim() ? parseAddonUrl(url) : null;
    const error = url.trim() && !parsed ? 'Paste a CurseForge, Wago or GitHub addon link.' : undefined;
    const reset = (): void => { setUrl(''); setDetails(EMPTY); };
    return (
        <div className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-3" data-testid="guild-addon-form">
            <Field label="Addon link" error={error ?? (failed ? 'Couldn’t add that addon. Check the link and try again.' : undefined)}
                hint="CurseForge, Wago or GitHub. The name comes from the link.">
                <Input type="url" inputMode="url" value={url} maxLength={GUILD_URL_MAX} placeholder="https://www.curseforge.com/wow/addons/…"
                    onChange={(e) => setUrl(e.target.value)} />
            </Field>
            {parsed && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-secondary" data-testid="guild-addon-preview">
                    Adding <span className="font-semibold text-foreground">{parsed.name}</span><Pill>{SOURCE_LABEL[parsed.source]}</Pill>
                </p>
            )}
            <AddonDetailFields value={details} onChange={setDetails} />
            <div className="flex justify-end">
                <Button onClick={() => parsed && onAdd({ url: url.trim(), ...details }, reset)} disabled={!parsed} loading={pending}
                    data-testid="guild-addon-add">Add addon</Button>
            </div>
        </div>
    );
}
