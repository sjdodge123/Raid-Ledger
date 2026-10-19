/** ROK-1836 — one character in the hub Characters tab: a §4.2 stretched-action card row. */
import { useNavigate } from 'react-router-dom';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { StretchedAction } from '../../../components/ui/stretched-action';
import { StatusChip } from '../../../components/ui/status-chip';
import { AvatarWithFallback } from '../../../components/shared/AvatarWithFallback';
import { ownerChip, updatedAgo } from '../lib/valheim-owner.helpers';
import { valheimCharacterHref } from '../lib/valheim-routes';

function Owner({ character }: { character: ValheimCharacterSummary }) {
    const owner = character.claimedBy;
    if (owner === null) {
        const chip = ownerChip(character);
        return <StatusChip tone={chip.tone} title={chip.title}>{chip.label}</StatusChip>;
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-secondary">
            <AvatarWithFallback avatarUrl={owner.avatar ?? null} username={owner.username} sizeClassName="h-5 w-5" alt="" />
            {owner.username}
        </span>
    );
}

/** `hubPath` rides in router state so the character page's crumb can return to this hub tab. */
export function ValheimCharacterRow({ character, hubPath }: { character: ValheimCharacterSummary; hubPath: string }) {
    const navigate = useNavigate();
    return (
        <li className="relative flex min-h-[44px] items-center gap-3 rounded-lg border border-edge bg-surface px-4 py-3 transition-colors hover:bg-overlay">
            <StretchedAction label={`Open ${character.name}`}
                onClick={() => navigate(valheimCharacterHref(character.id), { state: { hubPath } })} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-foreground">{character.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <Owner character={character} />
                    <span className="text-muted">World {character.worldName}</span>
                    <span className="text-muted">{updatedAgo(character.capturedAt)}</span>
                </div>
            </div>
            <span className="text-faint" aria-hidden="true">›</span>
        </li>
    );
}
