/**
 * ROK-1882 — the game server's own timezone: where a play day starts for
 * day-bucketed features (Valheim skill trends). Empty = the community default
 * (PATCH `{ timezone: null }`). Reuses the curated zone list the General
 * settings' Default timezone picker uses; a stored zone outside that list is
 * kept as its own option so it never reads as "Community default".
 */
import type { PelicanServerRowDto } from '@raid-ledger/contract';
import { Select } from '../../../components/ui/select';
import { TIMEZONE_GROUPS, TIMEZONE_OPTIONS } from '../../../constants/timezones';
import { getTimezoneAbbr } from '../../../lib/timezone-utils';
import type { ServerUpdateHandler } from './pelican-server-row';

export const COMMUNITY_DEFAULT_LABEL = 'Community default';

interface Props {
    row: PelicanServerRowDto;
    onUpdate: ServerUpdateHandler;
    inline?: boolean;
}

export function ServerTimezoneSelect({ row, onUpdate, inline = false }: Props) {
    const value = row.timezone ?? '';
    const listed = value === '' || TIMEZONE_OPTIONS.some((o) => o.id === value);
    return (
        <Select fieldSize={inline ? 'sm' : 'md'} aria-label="Timezone" data-testid={`pelican-server-${row.id}-timezone`}
            value={value} onChange={(e) => onUpdate(row.id, { timezone: e.target.value === '' ? null : e.target.value })}>
            <option value="">{COMMUNITY_DEFAULT_LABEL}</option>
            {!listed && <option value={value}>{value}</option>}
            {TIMEZONE_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                    {TIMEZONE_OPTIONS.filter((o) => o.group === group).map((o) => (
                        <option key={o.id} value={o.id}>{o.label} ({getTimezoneAbbr(o.id)})</option>
                    ))}
                </optgroup>
            ))}
        </Select>
    );
}
