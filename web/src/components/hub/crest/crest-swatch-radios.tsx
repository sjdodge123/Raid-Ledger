/**
 * ROK-1814 — a grid of visual radios (emblems, colour swatches): native radios
 * sharing one `name` in a `<fieldset>` named by its legend, so Tab/arrow keys
 * work as in `RadioGroup`; ON = the full-strength `border-success` ring.
 */
import type { JSX, ReactNode } from 'react';

export interface SwatchOption<V extends string> {
    value: V;
    label: string;
    swatch: ReactNode;
}

interface SwatchRadiosProps<V extends string> {
    legend: string;
    name: string;
    options: readonly SwatchOption<V>[];
    value: V;
    onChange: (value: V) => void;
    cellClassName: string;
    testId: string;
}

const CELL =
    'flex cursor-pointer items-center justify-center rounded-lg border-2 border-edge peer-checked:border-success peer-focus-visible:ring-2 peer-focus-visible:ring-success peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-panel';

/** Visual one-of-N picker (see file header). */
export function SwatchRadios<V extends string>(props: SwatchRadiosProps<V>): JSX.Element {
    const { legend, name, options, value, onChange, cellClassName, testId } = props;
    return (
        <fieldset role="radiogroup" className="min-w-0" data-testid={testId}>
            <legend className="mb-2 text-sm font-medium text-secondary">{legend}</legend>
            <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                    <label key={o.value} title={o.label}>
                        <input
                            type="radio" className="peer sr-only" name={name} value={o.value} aria-label={o.label}
                            checked={o.value === value} onChange={() => onChange(o.value)}
                        />
                        <span className={`${CELL} ${cellClassName}`}>{o.swatch}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
