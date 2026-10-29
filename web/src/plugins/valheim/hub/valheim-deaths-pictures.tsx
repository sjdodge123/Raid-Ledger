/**
 * ROK-1941 (Q1 = A) — a Deaths meter row's second line: up to three 40px death
 * thumbnails in 44px `Button` targets, then "+N" for the rest. It sits OUTSIDE
 * the row's map `<Link>` (no nested interactive). A thumb opens the Gallery
 * viewer at that picture with the Deaths chip on; "+N" opens the Gallery grid
 * scoped to THIS bar's deaths (ROK-2027: `subject = valheim-death:<bar key>`,
 * the set `pictureCount` counts) — D14: the dialog is mounted by the hub
 * Overview. Tokens only.
 */
import type { JSX } from 'react';
import type { ValheimDeathPicture, ValheimDeathPlayer } from '@raid-ledger/contract';
import { useHubGalleryStore } from '../../../components/hub/gallery/hub-gallery-store';
import { Button } from '../../../components/ui/button';
import { useHubMediaImageUrl } from '../../../hooks/use-hub-media-image';
import { deathThumbLabel, morePicturesLabel } from './valheim-deaths.helpers';

/** 44px target, 2px inset so the 40px picture tile reads as the control (mockup A). */
const TARGET = 'group h-11 w-11 shrink-0 rounded-lg p-0.5';
const TILE = 'flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-edge bg-panel transition-colors group-hover:border-edge-strong';

function DeathThumb({ name, picture, onOpen }: {
    name: string; picture: ValheimDeathPicture; onOpen: (el: HTMLButtonElement) => void;
}): JSX.Element {
    const url = useHubMediaImageUrl(picture.thumbPath);
    return (
        <Button variant="bare" aria-label={deathThumbLabel(name, picture)} data-testid="valheim-death-thumb"
            onClick={(e) => onOpen(e.currentTarget)} className={TARGET}>
            <span className={TILE}>
                {url !== null && <img src={url} alt="" className="h-full w-full object-cover group-hover:brightness-110" />}
            </span>
        </Button>
    );
}

/** The strip, or null when the bar has no visible pictures (both fields absent, D13). */
export function ValheimDeathsPictures({ player, guildId }: { player: ValheimDeathPlayer; guildId: number }): JSX.Element | null {
    const openGallery = useHubGalleryStore((s) => s.openGallery);
    const pictures = player.pictures ?? [];
    if (pictures.length === 0) return null;
    const extra = Math.max(0, (player.pictureCount ?? pictures.length) - pictures.length);
    return (
        <div role="group" aria-label={`${player.name}'s death pictures`} className="flex gap-1 px-1.5 pb-1.5">
            {pictures.map((p) => (
                <DeathThumb key={p.mediaId} name={player.name} picture={p}
                    onOpen={(el) => openGallery({ guildId, mode: 'viewer', filter: 'death', index: 0, mediaId: p.mediaId, returnFocus: el })} />
            ))}
            {extra > 0 && (
                <Button variant="bare" aria-label={morePicturesLabel(extra)} data-testid="valheim-death-thumbs-more"
                    onClick={(e) => openGallery({
                        guildId, mode: 'grid', filter: 'death', index: 0,
                        subject: { id: `valheim-death:${player.key}`, label: player.name }, returnFocus: e.currentTarget,
                    })}
                    className={`${TARGET} text-xs font-medium text-secondary hover:text-foreground`}>
                    <span className={TILE}>+{extra}</span>
                </Button>
            )}
        </div>
    );
}
