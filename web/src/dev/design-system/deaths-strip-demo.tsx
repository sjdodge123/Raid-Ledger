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

function DemoRow(): JSX.Element {
    const frame = 'flex min-h-[44px] flex-col justify-center gap-1 rounded-md px-2 py-1';
    return (
        <a href="#hub-widgets" aria-label="Jasz, 7 deaths — show on map" data-testid="ds-deaths-strip-row"
            className={`${frame} transition-colors hover:bg-overlay ${FOCUS_RING}`}>
            <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-foreground">{PLAYER.name}</span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{PLAYER.deaths}</span>
            </span>
            <GuildMeter pct={100} label="Jasz: 7 deaths" />
        </a>
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
