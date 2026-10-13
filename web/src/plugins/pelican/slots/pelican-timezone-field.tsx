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

export function PelicanTimezoneField({ value, onChange, inherited }: {
    value: string; onChange: (tz: string) => void; inherited: boolean;
}) {
    const options = useMemo(() => buildZoneOptions(), []);
    const selected = labelFor(options, value);
    const [text, setText] = useState(selected.label);
    const hint = 'Pelican’s API doesn’t say which timezone a schedule uses. Raid Ledger reads schedules in this zone.'
        + (inherited ? ' Prefilled from the community default.' : '');
    return (
        <Field id="pelicanDefaultTimezone" label="Default timezone" hint={hint}>
            <Combobox<ZoneOption>
                options={filterZones(options, text === selected.label ? '' : text)}
                getKey={(o) => o.id} getLabel={(o) => o.label}
                value={selected} onChange={(o) => { if (o) onChange(o.id); }}
                inputValue={text} onInputChange={setText}
                placeholder="Search timezones" fieldSize="lg" openOnFocus
                emptyText="No matching timezone" testIds={{ input: 'pelican-timezone-input' }}
            />
        </Field>
    );
}
