/**
 * ROK-1814 Q11 / ROK-2074 — the hero crest. A crest with a picture is a
 * "View hub picture" button for everyone: a crest picked from the Gallery
 * (`crestMediaId`) opens that picture in the Gallery viewer, any other upload
 * opens `urlLg` there as a single picture; a preset (no image) is not
 * clickable. A crest editor (`viewer.canEditCrest`, which adds the in-game GM
 * to `canEdit` — operator ruling 2026-10-30) also gets the pencil badge, the
 * ONLY "Change crest" target, which opens the picker.
 */
import { useState, type JSX } from 'react';
import { PencilIcon } from '@heroicons/react/20/solid';
import type { GuildCrest } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { openHubPicture, type HubPictureTarget } from '../gallery/hub-gallery-store';
import { HubCrest } from './hub-crest';
import { asCrestUpload, crestAssetUrl } from './hub-crest.helpers';
import { LazyCrestPicker } from './crest-picker-lazy';

interface HeroCrestProps {
    guildId: number;
    name: string;
    crest: GuildCrest | null | undefined;
    /** `page.guild.crestMediaId` — the Gallery picture the crest was picked from (ROK-2074). */
    crestMediaId?: number | null | undefined;
    canEdit: boolean;
    /** `viewer.isStaff` — passed to the picker for "Remove upload" (Q7). */
    isStaff?: boolean | undefined;
    className: string;
}

/** What clicking the crest opens; null for a preset or no crest (nothing to view). */
function heroCrestPicture(crest: GuildCrest | null | undefined, crestMediaId: number | null | undefined, name: string): HubPictureTarget | null {
    const upload = asCrestUpload(crest);
    if (upload === null) return null;
    const single = { url: crestAssetUrl(upload.urlLg), alt: `${name} crest` };
    // The link can go stale (the Gallery picture removed): the crest itself is the fallback.
    return crestMediaId != null ? { mediaId: crestMediaId, fallback: single } : single;
}

/** A 44px hit area (and its token focus ring) centred on the 24px badge, where the old decoration sat. */
function ChangeCrestBadge({ onOpen }: { onOpen: () => void }): JSX.Element {
    return (
        <span className="absolute -bottom-3.5 -right-3.5">
            <Button variant="bare" aria-label="Change crest" onClick={onOpen} data-testid="hub-crest-edit"
                className="group flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-offset-panel">
                <span aria-hidden="true"
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-edge-strong bg-overlay text-foreground group-hover:bg-surface">
                    <PencilIcon className="h-3.5 w-3.5" />
                </span>
            </Button>
        </span>
    );
}

export function HeroCrest({ guildId, name, crest, crestMediaId, canEdit, isStaff = false, className }: HeroCrestProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const picture = heroCrestPicture(crest, crestMediaId, name);
    if (!canEdit && picture === null) return <HubCrest crest={crest} name={name} size="hero" className={className} />;
    const art = <HubCrest crest={crest} name={name} size="hero" />;
    return (
        <div className={`relative shrink-0 ${className}`} data-testid="hub-crest-frame">
            {picture === null ? art : (
                <Button variant="bare" aria-label="View hub picture" data-testid="hub-crest-view"
                    onClick={(e) => openHubPicture(guildId, picture, e.currentTarget)}
                    className="rounded-xl focus-visible:ring-offset-2 focus-visible:ring-offset-panel">
                    {art}
                </Button>
            )}
            {canEdit && <ChangeCrestBadge onOpen={() => setOpen(true)} />}
            {open && <LazyCrestPicker guildId={guildId} name={name} isStaff={isStaff} onClose={() => setOpen(false)} />}
        </div>
    );
}
