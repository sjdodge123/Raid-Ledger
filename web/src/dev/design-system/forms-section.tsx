/**
 * Forms section for /dev/design-system (ROK-1646) — the form primitives from
 * `web/src/components/ui`: `Button`, `Field`, `Input`. Every example mounts the
 * REAL component, so this page is the early warning if one drifts.
 *
 * Check both families: the side-by-side toggle renders this twice, and the
 * focus ring (`ring-success/80`) is the value to eyeball — Tab through the
 * examples in default-dark, default-light and sky. The /80 alpha was picked to
 * clear 3:1 on `bg-panel` in both families (see `form-classes.ts`).
 */
import type { JSX } from 'react';
import { EyeIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Section, StateFrame, StateGrid } from './design-system-bits';

const noop = (): void => undefined;

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
            <StateFrame label="Input — leading / trailing" note="leading is decorative; trailing takes a 44px button.">
                <Field label="Search" hideLabel className="w-full">
                    <Input placeholder="Search games…" leading={<MagnifyingGlassIcon className="w-5 h-5" />} />
                </Field>
                <Field label="Password" className="w-full">
                    <Input type="password" defaultValue="hunter2" trailing={
                        <Button iconOnly aria-label="Show password" variant="ghost" onClick={noop}><EyeIcon className="w-5 h-5" /></Button>
                    } />
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

/** The form primitives in every state they ship in. */
export function FormsSection(): JSX.Element {
    return (
        <Section
            id="forms"
            title="Forms — Button, Field, Input"
            blurb="The shared form primitives (ROK-1646). Use these, not a hand-written class string: one focus ring (success token), one disabled treatment, errors inline under the field."
        >
            <div data-testid="ds-forms">
                <StateGrid>
                    <ButtonVariants />
                    <FieldStates />
                    <InputVariants />
                </StateGrid>
            </div>
        </Section>
    );
}
