/**
 * Forms section for /dev/design-system (ROK-1646) — the form primitives from
 * `web/src/components/ui`: `Button`, `Field`, `Input`, `Select`, `Textarea`,
 * `Checkbox`, `RadioGroup`, `Slider`, `SearchInput`, `Combobox`, plus ROK-1655's
 * `PasswordInput` here and `FilePicker` / `ColorInput` / `Button brandColor` in
 * forms-pickers-demo.tsx, and ROK-1653's segmented "All" filter and row-menu
 * recipes in forms-recipes-demo.tsx. Every example mounts the REAL component, so this page
 * is the early warning if one drifts.
 *
 * Check both families: the side-by-side toggle renders this twice, and the
 * focus ring (`ring-success/80`) is the value to eyeball — Tab through the
 * examples in default-dark, default-light and sky. The /80 alpha was picked to
 * clear 3:1 on `bg-panel` in both families (see `form-classes.ts`). Native
 * checkbox / radio / range chrome follows the ROOT `color-scheme`, so judge
 * those with the page-level scheme switcher, not the scoped side-by-side.
 */
import { useState, type JSX } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { PasswordInput } from '../../components/ui/password-input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Checkbox } from '../../components/ui/checkbox';
import { RadioGroup } from '../../components/ui/radio-group';
import { Slider } from '../../components/ui/slider';
import { SearchInput } from '../../components/ui/search-input';
import { Combobox } from '../../components/ui/combobox';
import { Section, StateFrame, StateGrid } from './design-system-bits';
import { PickerStates } from './forms-pickers-demo';
import { RecipeStates } from './forms-recipes-demo';

function ButtonVariants(): JSX.Element {
    return (
        <>
            <StateFrame label="Button — variants" note="Solid fills stay bg-emerald-600 / bg-red-600: index.css forces their label white on light.">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Delete</Button>
                <Button variant="destructive-soft">Clear</Button>
            </StateFrame>
            <StateFrame label="Button — sizes" note="sm drops to 36px from lg only; every size is 44px below lg.">
                <Button size="sm" variant="secondary">Small</Button>
                <Button variant="secondary">Medium</Button>
                <Button size="lg" variant="secondary">Large</Button>
            </StateFrame>
            <StateFrame label="Button — disabled / loading / icon-only" note="loading = aria-busy + disabled, label kept invisible so the width holds.">
                <Button disabled>Disabled</Button>
                <Button loading loadingLabel="Saving…">Save</Button>
                <Button iconOnly aria-label="Close" variant="ghost"><XMarkIcon className="w-5 h-5" /></Button>
            </StateFrame>
        </>
    );
}

function FieldStates(): JSX.Element {
    return (
        <>
            <StateFrame label="Field + Input — label, hint, required">
                <Field label="Title" hint="Shown on the event card." required className="w-full">
                    <Input placeholder="Raid night" />
                </Field>
            </StateFrame>
            <StateFrame label="Field + Input — inline error" note="role=alert text-danger; aria-invalid paints the border.">
                <Field label="Event name" error="Give the event a name." className="w-full">
                    <Input defaultValue="" />
                </Field>
            </StateFrame>
            <StateFrame label="Field + Input — disabled">
                <Field label="Slug" className="w-full">
                    <Input value="raid-night" disabled readOnly />
                </Field>
            </StateFrame>
        </>
    );
}

function InputVariants(): JSX.Element {
    return (
        <>
            <StateFrame label="Input — leading / PasswordInput" note="leading is decorative; PasswordInput's Show/Hide toggle is the 44px trailing Button.">
                <Field label="Search" hideLabel className="w-full">
                    <Input placeholder="Search games…" leading={<MagnifyingGlassIcon className="w-5 h-5" />} />
                </Field>
                <Field label="Password" className="w-full">
                    <PasswordInput label="Password" defaultValue="hunter2" />
                </Field>
            </StateFrame>
            <StateFrame label="Input — fieldSize sm / md / lg" note="text-base below lg stops iOS zoom; sm is compact from lg only.">
                <Input aria-label="Small" fieldSize="sm" placeholder="sm" />
                <Input aria-label="Medium" placeholder="md" />
                <Input aria-label="Large" fieldSize="lg" placeholder="lg" />
            </StateFrame>
            <StateFrame label="Input — mono">
                <Input aria-label="Invite code" mono readOnly value="RL-7F3K-92QX" />
            </StateFrame>
        </>
    );
}

function SelectTextareaStates(): JSX.Element {
    return (
        <>
            <StateFrame label="Select — placeholder / error" note="Native select, appearance-none + text-muted chevron.">
                <Field label="Region" className="w-full">
                    <Select placeholder="Pick a region" defaultValue="">
                        <option value="na">North America</option>
                        <option value="eu">Europe</option>
                    </Select>
                </Field>
                <Field label="Timezone" error="Pick a timezone." className="w-full">
                    <Select placeholder="Select…" defaultValue=""><option value="utc">UTC</option></Select>
                </Field>
            </StateFrame>
            <StateFrame label="Textarea — counter" note="showCount + maxLength: text-xs text-dim, aria-live polite, in the description.">
                <Field label="Reason" hint="Shown to the organiser." className="w-full">
                    <Textarea rows={3} showCount maxLength={200} defaultValue="Running late — 15 minutes." />
                </Field>
            </StateFrame>
        </>
    );
}

const DURATIONS = [
    { value: '1h', label: '1h' }, { value: '2h', label: '2h' }, { value: '3h', label: '3h' }, { value: '4h', label: '4h+' },
];
const SCOPES = [
    { value: 'this', label: 'This event' },
    { value: 'future', label: 'This and following', description: 'Every later event in the series.' },
];

function ChoiceStates(): JSX.Element {
    const [duration, setDuration] = useState('2h');
    const [scope, setScope] = useState('this');
    const [owners, setOwners] = useState(3);
    return (
        <>
            <StateFrame label="Checkbox — label / description / indeterminate / disabled" note="w-5 h-5 accent-success; the whole 44px row is the target.">
                <div className="flex flex-col">
                    <Checkbox label="Notify me" defaultChecked />
                    <Checkbox label="Public" description="Anyone with the link can view." />
                    <Checkbox label="Select all" indeterminate />
                    <Checkbox label="Locked" disabled />
                </div>
            </StateFrame>
            <StateFrame label="RadioGroup — segmented / list" note="Native radios: Tab to the checked one, arrows move and select. ON = bg-overlay + a full success border (the 3:1 indicator in light themes, ROK-1688).">
                <RadioGroup label="Duration" appearance="segmented" options={DURATIONS} value={duration} onChange={setDuration} className="w-full" />
                <RadioGroup label="Apply to" options={SCOPES} value={scope} onChange={setScope} className="w-full" />
            </StateFrame>
            <StateFrame label="Slider — label, mono readout" note="h-11 hit area; unfilled track is native chrome — check at the root scheme.">
                <Slider label="Min owners" min={0} max={15} value={owners} onChange={setOwners} wrapperClassName="w-full" />
                <Slider label="Threshold" value={40} onChange={() => undefined} formatValue={(v) => `${v}%`} disabled wrapperClassName="w-full" />
            </StateFrame>
        </>
    );
}

interface DemoGame { id: string; name: string }
const DEMO_GAMES: DemoGame[] = ['Diablo IV', 'Destiny 2', 'Dota 2', 'Final Fantasy XIV', 'World of Warcraft']
    .map((name, i) => ({ id: String(i), name }));

function GameComboboxDemo(): JSX.Element {
    const [game, setGame] = useState<DemoGame | null>(null);
    const [text, setText] = useState('');
    const matches = DEMO_GAMES.filter((g) => g.name.toLowerCase().includes(text.trim().toLowerCase()));
    return (
        <Field label="Game" hint="Arrows move, Enter picks, Esc closes (twice clears)." className="w-full">
            <Combobox<DemoGame> options={matches} getKey={(g) => g.id} getLabel={(g) => g.name}
                value={game} onChange={setGame} inputValue={text} onInputChange={setText}
                emptyText="No games found" placeholder="Search games…" />
        </Field>
    );
}

function SearchStates(): JSX.Element {
    const [query, setQuery] = useState('thrall');
    return (
        <>
            <StateFrame label="SearchInput — leading icon, 44px Clear search" note="type=search; the native cancel glyph is hidden so there is one clear affordance.">
                <Field label="Search players" hideLabel className="w-full">
                    <SearchInput value={query} onChange={setQuery} placeholder="Search players…" />
                </Field>
            </StateFrame>
            <StateFrame label="Combobox — portalled listbox" note="bg-surface border-edge popup, active row bg-overlay, 44px rows below lg; aria-activedescendant keeps focus in the input.">
                <GameComboboxDemo />
            </StateFrame>
        </>
    );
}

/** The form primitives in every state they ship in. */
export function FormsSection(): JSX.Element {
    return (
        <Section
            id="forms"
            title="Forms — the form primitives"
            blurb="The shared form primitives (ROK-1646). Use these, not a hand-written class string: one focus ring (success token), one disabled treatment, errors inline under the field."
        >
            <div data-testid="ds-forms">
                <StateGrid>
                    <ButtonVariants />
                    <FieldStates />
                    <InputVariants />
                    <SelectTextareaStates />
                    <ChoiceStates />
                    <SearchStates />
                    <PickerStates />
                    <RecipeStates />
                </StateGrid>
            </div>
        </Section>
    );
}
