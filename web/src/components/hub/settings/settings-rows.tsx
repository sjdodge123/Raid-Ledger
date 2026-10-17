/**
 * ROK-1830 S4 — the row vocabulary of the "Guild settings" sheet. Two shapes
 * only: a titled section, and a switch row whose helper line doubles as the
 * switch's description. A switch with no endpoint behind it is rendered
 * disabled with the reason in that same line (never hidden, never invented) —
 * the sheet is a map of what this hub can be configured with.
 */
import { useId, type JSX, type ReactNode } from 'react';
import { Switch } from '../../ui/switch';

interface SectionProps {
    title: string;
    blurb?: string;
    testId?: string;
    children: ReactNode;
}

export function SettingsSection({ title, blurb, testId, children }: SectionProps): JSX.Element {
    return (
        <section data-testid={testId} className="flex flex-col gap-3 border-b border-edge-subtle pb-5 last:border-b-0 last:pb-0">
            <div>
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                {blurb && <p className="mt-1 text-sm text-muted">{blurb}</p>}
            </div>
            {children}
        </section>
    );
}

interface SwitchRowProps {
    label: string;
    /** Helper line under the label; also the switch's accessible description. */
    hint: string;
    checked: boolean;
    disabled?: boolean;
    onChange?: (checked: boolean) => void;
    testId?: string;
}

const NOOP = (): void => undefined;

export function SettingsSwitchRow({ label, hint, checked, disabled = false, onChange, testId }: SwitchRowProps): JSX.Element {
    const hintId = useId();
    return (
        <div className="flex items-start justify-between gap-4" title={disabled ? hint : undefined}>
            <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p id={hintId} className="text-sm text-muted">{hint}</p>
            </div>
            <Switch label={label} checked={checked} disabled={disabled} aria-describedby={hintId}
                onChange={onChange ?? NOOP} {...(testId ? { testId } : {})} />
        </div>
    );
}
