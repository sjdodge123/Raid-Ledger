/**
 * ROK-1941 (Q1 = A) — /dev/design-system demo of the "thumbnail strip in a
 * meter row" pattern (design-system §4 "New pattern"). Renders the REAL
 * `ValheimDeathsPictures` under a Deaths-style `GuildMeter` row, as a sibling
 * of the row's link (never inside it). Lazy-loaded by hub-widgets-section.tsx.
 * Its pictures are the Gallery demo's death items (hub -1, ids 1 / 4 / 7), so
 * a thumb opens that demo's viewer at the same picture; "+2" its grid.
 */
import { useState, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MapPinIcon } from '@heroicons/react/24/outline';
import type { ValheimDeathPlayer } from '@raid-ledger/contract';
import { GuildMeter } from '../../components/hub/events/guild-meter';
import { FOCUS_RING } from '../../components/ui/form-classes';
import { ValheimDeathsPictures } from '../../plugins/valheim/hub/valheim-deaths-pictures';

const HUB = -1;
/** Gallery-demo item indexes whose kind is `death` (ids = index + 1). */
const DEATH_INDEXES = [0, 3, 6];

const PLAYER: ValheimDeathPlayer = {
    key: 'njasz', name: 'Jasz', characterId: null, deaths: 7, lastDeathAt: new Date(Date.now() - 3_600_000).toISOString(), pictureCount: 5,
    pictures: DEATH_INDEXES.map((i) => ({
        mediaId: i + 1, thumbPath: `/demo/gallery/${i}/thumb`,
        capturedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
    })),
};

/** Picture content, not UI chrome — the same flat hue the Gallery demo draws for that item. */
function picture(i: number): Blob {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="hsl(${(i * 47) % 360} 40% 38%)"/></svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
}

/** ROK-2029 row shape: the name and the count + pin are two separate links over the meter. */
function DemoRow(): JSX.Element {
    const link = `inline-flex min-h-[44px] items-center rounded-sm px-2 text-sm text-foreground hover:underline ${FOCUS_RING}`;
    return (
        <div data-testid="ds-deaths-strip-row">
            <div className="flex min-h-[44px] items-center justify-between gap-3">
                <a href="#hub-widgets" aria-label="Open Jasz's character page" className={`${link} min-w-0`}>
                    <span className="truncate">{PLAYER.name}</span>
                </a>
                <a href="#hub-widgets" aria-label="Show Jasz's 7 deaths on the map"
                    className={`${link} min-w-[44px] shrink-0 justify-end gap-1 font-medium tabular-nums`}>
                    {PLAYER.deaths}
                    <MapPinIcon aria-hidden="true" className="h-4 w-4 text-muted" />
                </a>
            </div>
            <div className="px-2 pb-1"><GuildMeter pct={100} label="Jasz: 7 deaths" /></div>
        </div>
    );
}

export default function DeathsStripDemo(): JSX.Element {
    const qc = useQueryClient();
    useState(() => {
        DEATH_INDEXES.forEach((i) => qc.setQueryData(['hub-media', 'file', `/demo/gallery/${i}/thumb`], picture(i)));
        return true;
    });
    return (
        <ol className="-mx-2 flex max-w-sm flex-col" aria-label="Deaths by player" data-testid="ds-deaths-strip">
            <li><DemoRow /><ValheimDeathsPictures player={PLAYER} guildId={HUB} /></li>
        </ol>
    );
}
