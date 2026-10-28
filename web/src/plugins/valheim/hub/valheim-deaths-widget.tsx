/**
 * ROK-1930 — the Valheim server hub Overview "Deaths" card (option A): one
 * `GuildMeter` bar per player, top 8, scaled to the top player, in the order
 * the API serves. A bar with a character is a link to that character's death
 * pins on the Map tab (D13); one without is plain text. Players who left the
 * hub still show (Q6). ROK-2029: the name links to the character page and the
 * count + map pin is the (separate) link to their death pins. ROK-1941: a row with death pictures gets a thumb strip
 * under the meter (`valheim-deaths-pictures.tsx`). Default export so
 * `register.ts` can `React.lazy` it.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { MapPinIcon } from '@heroicons/react/24/outline';
import type { ValheimDeathPlayer } from '@raid-ledger/contract';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { HUB_PAGE_PREFIX } from '../../../components/routing/hub-paths';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { useTimezoneStore } from '../../../stores/timezone-store';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useValheimDeaths } from '../hooks/use-valheim-deaths';
import { valheimCharacterHref } from '../lib/valheim-routes';
import { ValheimDeathsPictures } from './valheim-deaths-pictures';
import { countedSinceLine, deathsMapHref, meterPct, visibleRows } from './valheim-deaths.helpers';

const deathsWord = (n: number): string => `${n} ${n === 1 ? 'death' : 'deaths'}`;

const LINK_BASE = `inline-flex min-h-[44px] items-center rounded-sm text-sm text-foreground hover:underline ${FOCUS_RING}`;
const NAME_TEXT = 'min-w-0 truncate text-sm text-foreground';
const COUNT_TEXT = 'shrink-0 text-sm font-medium tabular-nums text-foreground';

/** ROK-2029: the name opens the character page; plain text for a name-only player. */
function PlayerName({ player, guildId }: { player: ValheimDeathPlayer; guildId: number }): JSX.Element {
    if (player.characterId === null) return <span className={`${NAME_TEXT} px-2`}>{player.name}</span>;
    return (
        <Link to={valheimCharacterHref(player.characterId)} state={{ hubPath: `${HUB_PAGE_PREFIX}${guildId}` }}
            aria-label={`Open ${player.name}'s character page`} data-testid="valheim-deaths-name-link"
            className={`${LINK_BASE} min-w-0 px-2`}>
            <span className="truncate">{player.name}</span>
        </Link>
    );
}

/** ROK-2029: the count + pin opens that character's death pins on the Map tab (the old whole-row link). */
function DeathsMapLink({ player }: { player: ValheimDeathPlayer }): JSX.Element {
    const href = deathsMapHref(player);
    if (href === null) return <span className={`${COUNT_TEXT} px-2`}>{player.deaths}</span>;
    return (
        <Link to={href} aria-label={`Show ${player.name}'s ${deathsWord(player.deaths)} on the map`}
            data-testid="valheim-deaths-map-link"
            className={`${LINK_BASE} min-w-[44px] shrink-0 justify-end gap-1 px-2 font-medium tabular-nums`}>
            {player.deaths}
            <MapPinIcon aria-hidden="true" className="h-4 w-4 text-muted" />
        </Link>
    );
}

function DeathRow({ player, max, guildId }: { player: ValheimDeathPlayer; max: number; guildId: number }): JSX.Element {
    // ROK-1941 Q1 = A: the picture strip is a sibling of both links, never inside one.
    return (
        <li data-testid="valheim-deaths-row" data-key={player.key}>
            <div className="flex min-h-[44px] items-center justify-between gap-3">
                <PlayerName player={player} guildId={guildId} />
                <DeathsMapLink player={player} />
            </div>
            <div className="px-2 pb-1">
                <GuildMeter pct={meterPct(player.deaths, max)} label={`${player.name}: ${deathsWord(player.deaths)}`} />
            </div>
            <ValheimDeathsPictures player={player} guildId={guildId} />
        </li>
    );
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
