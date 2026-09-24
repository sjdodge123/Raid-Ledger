/**
 * Forms section, part 2 (ROK-1655 PR-1): `FilePicker`, `ColorInput` and
 * `Button brandColor`. Split from forms-section.tsx to keep that file small;
 * every example mounts the real primitive.
 *
 * Check both families with the side-by-side toggle: the FilePicker trigger is
 * the secondary Button (tokens), the ColorInput well is `border-edge`, and the
 * brandColor label must stay white on default-light — `data-brand-fill` joins
 * the index.css forced-white rule.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { FilePicker } from '../../components/ui/file-picker';
import { ColorInput } from '../../components/ui/color-input';
import { StateFrame } from './design-system-bits';

/**
 * Runtime provider data, as the Discord plugin registers it
 * (plugins/discord/register.ts) — brandColor takes data like this, never a theme colour.
 */
const DISCORD_BRAND = '#5865F2';
/** Stands in for a community's saved accent (BrandingSection) — caller data, not a theme value. */
const DEMO_ACCENT = '#10b981';

interface Picks { name: string; count: number }

/** "Picked <name> · <n> picks" — the count moves on every onFiles, so a same-file re-pick shows. */
const picksText = (p: Picks | null): string =>
    (p ? `Picked ${p.name} · ${p.count} pick${p.count === 1 ? '' : 's'}` : 'No file picked');

function FilePickerDemo(): JSX.Element {
    const [picks, setPicks] = useState<Picks | null>(null);
    const onFiles = (files: File[]): void => setPicks((p) => ({ name: files[0].name, count: (p?.count ?? 0) + 1 }));
    return (
        <StateFrame label="FilePicker — idle / loading" note="A secondary Button opens a hidden native input; onFiles gets File[] and the same file can be picked twice — the pick counter moves each time.">
            <FilePicker accept="image/png,image/jpeg" onFiles={onFiles}>Upload logo</FilePicker>
            <FilePicker onFiles={() => undefined} loading loadingLabel="Uploading…">Upload logo</FilePicker>
            <span className="text-xs text-muted" aria-live="polite">{picksText(picks)}</span>
        </StateFrame>
    );
}

function ColorInputDemo(): JSX.Element {
    const [accent, setAccent] = useState(DEMO_ACCENT);
    return (
        <StateFrame label="ColorInput — well + mono hex" note="Only a complete #rrggbb is reported; any other draft is aria-invalid and reverts on blur.">
            <Field label="Accent" hint="Pick with the well or type a hex." className="w-full">
                <ColorInput label="Accent" value={accent} onChange={setAccent} />
            </Field>
        </StateFrame>
    );
}

function BrandButtonDemo(): JSX.Element {
    return (
        <StateFrame label="Button — brandColor (runtime fill)" note="Provider / brand data only. The inline fill replaces the variant; the label stays white on every scheme.">
            <Button brandColor={DISCORD_BRAND}>Link Discord</Button>
            <Button brandColor={DISCORD_BRAND} size="sm">Continue with Discord</Button>
        </StateFrame>
    );
}

/** FilePicker, ColorInput and Button brandColor, for the Forms section grid. */
export function PickerStates(): JSX.Element {
    return (
        <>
            <FilePickerDemo />
            <ColorInputDemo />
            <BrandButtonDemo />
        </>
    );
}
