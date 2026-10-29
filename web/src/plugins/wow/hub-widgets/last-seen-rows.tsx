/**
 * ROK-1916 (W9) — the two lists of the "Last seen" card: "Online at last
 * export" (up to five names with a `bg-success` dot, then "+N more") and
 * "Longest away" (up to five rows, "34 d" / "today"). Names are a
 * `CharacterLink` when linked, plain text otherwise (spec D7). The day count
 * is relative to the export, never to now, so its `title` says so (Q3).
 */
import type { JSX } from 'react';
import type { WowRosterLastSeenDto } from '@raid-ledger/contract';
import { CharacterLink } from '../../../components/hub/character-link';
import { LAST_SEEN_ROWS, awayLabel, awayTitle } from './last-seen.helpers';

type AwayMember = WowRosterLastSeenDto['away'][number];

const NAME_CLASS = 'inline-block min-w-0 max-w-full truncate py-3 align-middle font-medium leading-5 text-foreground';
const ROW_CLASS = 'flex min-h-11 items-center gap-2 text-sm';

function SectionHeading({ children }: { children: string }): JSX.Element {
    return <h4 className="mt-3 text-xs font-semibold text-secondary">{children}</h4>;
}

/** "Online at last export": the dot list, "+N more", or the nobody-online line. */
export function OnlineSection({ lastSeen }: { lastSeen: WowRosterLastSeenDto }): JSX.Element {
    const shown = lastSeen.online.slice(0, LAST_SEEN_ROWS);
    const more = lastSeen.onlineCount - shown.length;
    if (lastSeen.onlineCount === 0) {
        return <p className="mt-3 text-sm text-muted">Nobody was online at the last export.</p>;
    }
    return (
        <section>
            <SectionHeading>Online at last export</SectionHeading>
            <ul className="divide-y divide-edge" aria-label="Online at last export">
                {shown.map((m, i) => (
                    <li key={`${m.name}:${i}`} data-testid="last-seen-online" className={ROW_CLASS}>
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success" />
                        <CharacterLink name={m.name} characterId={m.characterId} className={NAME_CLASS} />
                    </li>
                ))}
            </ul>
            {more > 0 && <p className="pt-1.5 text-xs text-dim">+{more} more</p>}
        </section>
    );
}

/** "Longest away": the five offline members with the most days. Nothing when empty. */
export function AwaySection({ away }: { away: readonly AwayMember[] }): JSX.Element | null {
    if (away.length === 0) return null;
    return (
        <section>
            <SectionHeading>Longest away</SectionHeading>
            <ul className="divide-y divide-edge" aria-label="Longest away">
                {away.slice(0, LAST_SEEN_ROWS).map((m, i) => (
                    <li key={`${m.name}:${i}`} data-testid="last-seen-away" className={`${ROW_CLASS} justify-between`}>
                        <CharacterLink name={m.name} characterId={m.characterId} className={NAME_CLASS} />
                        <span title={awayTitle(m.days)} className="shrink-0 text-xs tabular-nums text-muted">
                            {awayLabel(m.days)}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
