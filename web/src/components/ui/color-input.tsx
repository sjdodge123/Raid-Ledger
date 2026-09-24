/**
 * ColorInput — a colour well paired with a hex text field (ROK-1655 PR-1,
 * plan ruling 1; first site: BrandingSection's accent colour).
 *
 * - The well is a native `<input type="color">` named "<label> colour
 *   picker": 44px square, `rounded-lg`, `border-edge`, the shared focus ring
 *   and disabled treatment. The value it shows is the caller's data — nothing
 *   here is a hardcoded colour.
 * - The hex field is the shared `Input` with `mono`. Inside a `Field` it takes
 *   the Field's id, label, hint/error and required state from context; outside
 *   one it is named by `aria-label={label}`.
 * - The hex field keeps a draft. A draft matching `#rrggbb` (any case) is
 *   lowercased and reported through `onChange`; any other draft is marked
 *   `aria-invalid`, never reported, and reverts to `value` on blur.
 * - A well change reports the picked hex; a new `value` prop (well, preset,
 *   Reset) replaces the draft.
 * - Controlled only: the caller owns `value` and must feed `onChange` back.
 */
import { useState, type ChangeEvent, type JSX } from 'react';
import { Input } from './input';
import { useFieldContext } from './field-context';
import { DISABLED, FOCUS_RING } from './form-classes';

export interface ColorInputProps {
    /** The current colour as `#rrggbb`. */
    value: string;
    /** Called with a lowercased `#rrggbb` — from the well, or a valid hex draft. */
    onChange: (hex: string) => void;
    /** Names the well ("<label> colour picker") and, outside a Field, the hex field. */
    label: string;
    disabled?: boolean;
    invalid?: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;

const WELL_CLASS = [
    'h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-edge bg-panel p-1',
    FOCUS_RING,
    DISABLED,
].join(' ');

interface HexDraft {
    draft: string;
    valid: boolean;
    edit: (e: ChangeEvent<HTMLInputElement>) => void;
    commit: () => void;
}

/** The hex text draft: follows `value`, reports only a complete hex, reverts on blur. */
function useHexDraft(value: string, onChange: (hex: string) => void): HexDraft {
    const [draft, setDraft] = useState(value);
    const [synced, setSynced] = useState(value);
    if (value !== synced) {
        setSynced(value);
        setDraft(value);
    }
    const valid = HEX.test(draft);
    const edit = (e: ChangeEvent<HTMLInputElement>): void => {
        const next = e.target.value;
        setDraft(next);
        if (HEX.test(next)) onChange(next.toLowerCase());
    };
    const commit = (): void => setDraft(valid ? draft.toLowerCase() : value);
    return { draft, valid, edit, commit };
}

/** The native colour well. It shows the caller's `value`; it has no colour of its own. */
function ColorWell({ value, onChange, label, disabled }: Omit<ColorInputProps, 'invalid'>): JSX.Element {
    return (
        <input
            type="color"
            aria-label={`${label} colour picker`}
            value={value.toLowerCase()}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className={WELL_CLASS}
        />
    );
}

/** A native colour well paired with a mono hex field. See the file header for the contract. */
export function ColorInput({ value, onChange, label, disabled, invalid }: ColorInputProps): JSX.Element {
    const inField = useFieldContext() !== null;
    const { draft, valid, edit, commit } = useHexDraft(value, onChange);
    return (
        <div className="flex items-center gap-3">
            <ColorWell value={value} onChange={onChange} label={label} disabled={disabled} />
            <div className="w-28">
                <Input
                    type="text"
                    mono
                    aria-label={inField ? undefined : label}
                    value={draft}
                    onChange={edit}
                    onBlur={commit}
                    invalid={invalid || !valid}
                    disabled={disabled}
                    maxLength={7}
                    placeholder="#rrggbb"
                    spellCheck={false}
                    autoComplete="off"
                />
            </div>
        </div>
    );
}
