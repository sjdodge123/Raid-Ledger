/**
 * ROK-1814 Q11 — the hero crest. For `viewer.canEdit` it is a "Change crest"
 * button with a pencil badge that opens the picker (WoW Officers have no
 * settings sheet); everyone else sees the plain, `aria-hidden` crest.
 */
import { useState, type JSX } from 'react';
import { PencilIcon } from '@heroicons/react/20/solid';
import type { GuildCrest } from '@raid-ledger/contract';
import { HubCrest } from './hub-crest';
import { LazyCrestPicker } from './crest-picker-lazy';

interface HeroCrestProps {
    guildId: number;
    name: string;
    crest: GuildCrest | null | undefined;
    canEdit: boolean;
    className: string;
}

export function HeroCrest({ guildId, name, crest, canEdit, className }: HeroCrestProps): JSX.Element {
    const [open, setOpen] = useState(false);
    if (!canEdit) return <HubCrest crest={crest} name={name} size="hero" className={className} />;
    return (
        <>
            <button
                type="button" aria-label="Change crest" onClick={() => setOpen(true)} data-testid="hub-crest-edit"
                className={`relative rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-2 focus-visible:ring-offset-panel ${className}`}
            >
                <HubCrest crest={crest} name={name} size="hero" />
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-edge-strong bg-overlay text-foreground" aria-hidden="true">
                    <PencilIcon className="h-3.5 w-3.5" />
                </span>
            </button>
            {open && <LazyCrestPicker guildId={guildId} name={name} onClose={() => setOpen(false)} />}
        </>
    );
}
