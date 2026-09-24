/**
 * PasswordInput — the shared secret field (ROK-1655 PR-1, audit ROK-1644 §4.3,
 * plan ruling 2).
 *
 * - The shared `Input` with `type="password"` (hidden) or `type="text"`
 *   (revealed). `type` and `trailing` are not props: the toggle owns both.
 * - The toggle is the shared `Button` — `ghost`, `sm`, `iconOnly` — named
 *   "Show <label>" / "Hide <label>", with `aria-controls` pointing at the
 *   input. `label` names the toggle only; the input's own name still comes
 *   from the surrounding `Field` (or the caller's `aria-label`).
 * - Uncontrolled by default. Passing `revealed` makes it controlled: the
 *   toggle only calls `onRevealedChange(next)` and the type follows the prop
 *   (e.g. one "Show passwords" Checkbox driving several fields).
 * - Inside a `Field`, `id` / `aria-describedby` / `aria-invalid` /
 *   `aria-required` flow through `Input` unchanged; the ref reaches the <input>.
 */
import { forwardRef, useId, useState, type JSX } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Input, type InputProps } from './input';
import { Button } from './button';
import { useFieldContext } from './field-context';

export type PasswordInputProps = Omit<InputProps, 'type' | 'trailing'> & {
    /** Names the toggle: "Show <label>" / "Hide <label>". */
    label: string;
    /** Controlled reveal state. Omit for the uncontrolled default (hidden). */
    revealed?: boolean;
    onRevealedChange?: (next: boolean) => void;
};

/** The reveal state: the `revealed` prop when controlled, local state otherwise. */
function useRevealed(
    revealed: boolean | undefined,
    onRevealedChange: ((next: boolean) => void) | undefined,
): [boolean, () => void] {
    const [local, setLocal] = useState(false);
    const controlled = revealed !== undefined;
    const current = controlled ? revealed : local;
    const toggle = (): void => {
        if (!controlled) setLocal(!current);
        onRevealedChange?.(!current);
    };
    return [current, toggle];
}

function RevealToggle({ revealed, label, controls, onToggle }: {
    revealed: boolean; label: string; controls: string; onToggle: () => void;
}): JSX.Element {
    const Icon = revealed ? EyeSlashIcon : EyeIcon;
    return (
        <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`${revealed ? 'Hide' : 'Show'} ${label}`}
            aria-controls={controls}
            onClick={onToggle}
        >
            <Icon className="w-5 h-5" aria-hidden="true" />
        </Button>
    );
}

/** The shared password / secret input. See the file header for the contract. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(props, ref) {
    const { label, revealed, onRevealedChange, id, ...rest } = props;
    const field = useFieldContext();
    const generated = useId();
    const inputId = id ?? field?.id ?? generated;
    const [shown, toggle] = useRevealed(revealed, onRevealedChange);
    return (
        <Input
            ref={ref}
            {...rest}
            id={inputId}
            type={shown ? 'text' : 'password'}
            trailing={<RevealToggle revealed={shown} label={label} controls={inputId} onToggle={toggle} />}
        />
    );
});
