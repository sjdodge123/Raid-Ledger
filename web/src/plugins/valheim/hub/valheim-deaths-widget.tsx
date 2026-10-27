/**
 * ROK-1930 — the Valheim server hub Overview "Deaths" card (option A): one
 * `GuildMeter` bar per player, top 8, scaled to the top player, in the order
 * the API serves. A bar with a character is a link to that character's death
 * pins on the Map tab (D13); one without is plain text. Players who left the
 * hub still show (Q6). ROK-1941: a row with death pictures gets a thumb strip
 * under the meter (`valheim-deaths-pictures.tsx`). Default export so
 * `register.ts` can `React.lazy` it.
 */
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ValheimDeathPlayer } from '@raid-ledger/contract';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { useTimezoneStore } from '../../../stores/timezone-store';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useValheimDeaths } from '../hooks/use-valheim-deaths';
import { ValheimDeathsPictures } from './valheim-deaths-pictures';
import { countedSinceLine, deathsMapHref, meterPct, visibleRows } from './valheim-deaths.helpers';

const deathsWord = (n: number): string => `${n} ${n === 1 ? 'death' : 'deaths'}`;

function RowBody({ player, max }: { player: ValheimDeathPlayer; max: number }): JSX.Element {
    return (
        <>
            <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-foreground">{player.name}</span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{player.deaths}</span>
            </span>
            <GuildMeter pct={meterPct(player.deaths, max)} label={`${player.name}: ${deathsWord(player.deaths)}`} />
        </>
    );
}

function DeathRow({ player, max, guildId }: { player: ValheimDeathPlayer; max: number; guildId: number }): JSX.Element {
    const href = deathsMapHref(player);
    const frame = 'flex min-h-[44px] flex-col justify-center gap-1 rounded-md px-2 py-1';
    let row: ReactNode = <div className={frame}><RowBody player={player} max={max} /></div>;
    if (href !== null) {
        row = (
            <Link to={href} aria-label={`${player.name}, ${deathsWord(player.deaths)} — show on map`}
                className={`${frame} transition-colors hover:bg-overlay ${FOCUS_RING}`}>
                <RowBody player={player} max={max} />
            </Link>
        );
    }
    // ROK-1941 Q1 = A: the picture strip is a sibling of the row link, never inside it.
    return <li data-testid="valheim-deaths-row" data-key={player.key}>{row}<ValheimDeathsPictures player={player} guildId={guildId} /></li>;
}

export default function ValheimDeathsWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const serverId = page.server?.pelicanServerId ?? 0;
    const tz = useTimezoneStore((s) => s.resolved);
    const { data } = useValheimDeaths(serverId);
    if (data === undefined || data.players.length === 0) return null;
    const rows = visibleRows(data.players);
    const max = rows[0]?.deaths ?? 0;
    const since = countedSinceLine(data.since, tz);
    return (
        <div className="flex flex-col gap-2">
            <ol className="-mx-2 flex flex-col" aria-label="Deaths by player">
                {rows.map((p) => <DeathRow key={p.key} player={p} max={max} guildId={page.guild.id} />)}
            </ol>
            {since !== null && <p className="text-xs text-muted" data-testid="valheim-deaths-since">{since}</p>}
        </div>
    );
}
