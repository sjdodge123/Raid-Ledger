/**
 * ROK-1814 — a grid of visual radios (emblems, colour swatches). A thin
 * wrapper over the `RadioGroup` primitive's `swatch` appearance: native radios
 * sharing one `name` in a `<fieldset>` named by its legend, so Tab/arrow keys
 * work as in any `RadioGroup`; ON = the full-strength `border-success` ring.
 */
import type { JSX, ReactNode } from 'react';
import { RadioGroup } from '../../ui/radio-group';

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

/** Visual one-of-N picker (see file header). */
export function SwatchRadios<V extends string>(props: SwatchRadiosProps<V>): JSX.Element {
    const { legend, name, options, value, onChange, cellClassName, testId } = props;
    return (
        <div data-testid={testId}>
            <RadioGroup
                label={legend} name={name} options={options} value={value} onChange={onChange}
                appearance="swatch" optionClassName={cellClassName} className="min-w-0"
            />
        </div>
    );
}
