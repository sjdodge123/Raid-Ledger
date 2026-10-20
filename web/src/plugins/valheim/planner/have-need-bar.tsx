/**
 * ROK-1854 — how much of a requirement the chests already cover: the shared
 * `GuildMeter` (design-system §3.2) filled `min(have, need) / need`, with a
 * text equivalent in its `aria-label`. Nothing while there is no scan.
 */
import type { JSX } from 'react';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { formatAmount, havePct } from './planner.helpers';

export function HaveNeedBar({
    have,
    need,
    name,
}: {
    have: number | null;
    need: number;
    name: string;
}): JSX.Element | null {
    if (have === null) return null;
    const pct = havePct(have, need);
    return (
        <GuildMeter
            pct={pct}
            tone={pct >= 100 ? 'success' : 'warning'}
            label={`${name}: ${formatAmount(Math.min(have, need))} of ${formatAmount(need)} in chests`}
        />
    );
}
