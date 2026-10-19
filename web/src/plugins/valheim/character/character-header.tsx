/** ROK-1836 — character page header (§4.9): name, server + world, owner line, updated line. L4 fills `actions`. */
import type { JSX, ReactNode } from 'react';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { AvatarWithFallback } from '../../../components/shared/AvatarWithFallback';
import { buildDiscordAvatarUrl } from '../../../lib/avatar';
import { ownerChip, updatedAgo } from '../lib/valheim-owner.helpers';

function OwnerLine({ character }: { character: ValheimCharacterSummary }) {
    const chip = ownerChip(character);
    const owner = character.claimedBy;
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
            {owner === null ? (
                <span>No owner yet</span>
            ) : (
                <>
                    <span>Owned by</span>
                    <span className="inline-flex items-center gap-1.5">
                        <AvatarWithFallback
                            avatarUrl={buildDiscordAvatarUrl(owner.discordId, owner.avatar)}
                            username={owner.username}
                            sizeClassName="h-5 w-5"
                            alt=""
                        />
                        {owner.username}
                    </span>
                </>
            )}
            <StatusChip tone={chip.tone} title={chip.title}>
                {chip.label}
            </StatusChip>
        </div>
    );
}

function HeaderMeta({
    character,
}: {
    character: ValheimCharacterSummary;
}): JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-x-2 text-sm text-secondary">
                <span>{character.serverName} server</span>
                <span className="text-faint" aria-hidden="true">
                    ·
                </span>
                <span>World {character.worldName}</span>
            </div>
            <OwnerLine character={character} />
            <div className="text-xs text-dim">
                {updatedAgo(character.capturedAt)} · game{' '}
                {character.gameVersion}
            </div>
        </div>
    );
}

export function ValheimCharacterHeader({
    character,
    actions,
}: {
    character: ValheimCharacterSummary;
    actions?: ReactNode;
}) {
    return (
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                <h1 className="mb-2 break-words text-3xl font-bold text-foreground">
                    {character.name}
                </h1>
                <HeaderMeta character={character} />
            </div>
            {actions !== undefined && (
                <div className="flex flex-wrap gap-2">{actions}</div>
            )}
        </header>
    );
}
