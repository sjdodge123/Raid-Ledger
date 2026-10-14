/**
 * Searchable IANA timezone picker for the Pelican panel default (ROK-121 Q6):
 * the shared `Combobox` over every zone this browser knows, curated zones
 * first and labelled with their friendly name.
 */
import { useMemo, useState } from 'react';
import { Combobox } from '../../../components/ui/combobox';
import { Field } from '../../../components/ui/field';
import { TIMEZONE_OPTIONS } from '../../../constants/timezones';

interface ZoneOption { id: string; label: string }

const MAX_SHOWN = 50;

function allZoneIds(): string[] {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
    return intl.supportedValuesOf?.('timeZone') ?? TIMEZONE_OPTIONS.map((o) => o.id);
}

/** Curated zones (friendly label) then every other zone (its id), de-duplicated. */
function buildZoneOptions(): ZoneOption[] {
    const curated = TIMEZONE_OPTIONS.map((o) => ({ id: o.id, label: `${o.label} — ${o.id}` }));
    const seen = new Set(curated.map((o) => o.id));
    const rest = allZoneIds().filter((id) => !seen.has(id)).map((id) => ({ id, label: id }));
    return [...curated, ...rest];
}

function filterZones(options: ZoneOption[], text: string): ZoneOption[] {
    const q = text.trim().toLowerCase();
    if (q === '') return options.slice(0, MAX_SHOWN);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
}

function labelFor(options: ZoneOption[], id: string): ZoneOption {
    return options.find((o) => o.id === id) ?? { id, label: id };
}

/**
 * Per-row reuse (ROK-1094 servers table) passes its own `id`, `label`, `hint` and
 * `testId`; a table row also sets `hideLabel` (its column header is the label).
 */
export interface PelicanTimezoneFieldProps {
    value: string; onChange: (tz: string) => void; inherited: boolean;
    id?: string; label?: string; hint?: string; testId?: string; hideLabel?: boolean;
    /** A `text-warning` line under the hint (ROK-1096). It sits inside the hint, so the input's `aria-describedby` reads it. */
    warning?: string | undefined;
}

const DEFAULT_HINT = 'Pelican’s API doesn’t say which timezone a schedule uses. Raid Ledger reads schedules in this zone.';

export function PelicanTimezoneField({
    value, onChange, inherited, id = 'pelicanDefaultTimezone', label = 'Default timezone', hint: hintText = DEFAULT_HINT,
    testId = 'pelican-timezone-input', hideLabel = false, warning,
}: PelicanTimezoneFieldProps) {
    const options = useMemo(() => buildZoneOptions(), []);
    const selected = labelFor(options, value);
    const [text, setText] = useState(selected.label);
    const hintLine = hintText + (inherited && hintText === DEFAULT_HINT ? ' Prefilled from the community default.' : '');
    const hint = warning === undefined ? hintLine
        : <>{hintLine}<span data-testid={`${testId}-warning`} className="mt-1 block text-warning">{warning}</span></>;
    return (
        <Field id={id} label={label} hint={hint} hideLabel={hideLabel}>
            <Combobox<ZoneOption>
                options={filterZones(options, text === selected.label ? '' : text)}
                getKey={(o) => o.id} getLabel={(o) => o.label}
                value={selected} onChange={(o) => { if (o) onChange(o.id); }}
                inputValue={text} onInputChange={setText}
                placeholder="Search timezones" fieldSize="lg" openOnFocus
                emptyText="No matching timezone" testIds={{ input: testId }}
            />
        </Field>
    );
}
