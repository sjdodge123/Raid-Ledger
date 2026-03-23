/**
 * Nomination card for a single game in the Community Lineup (ROK-935).
 * Shows cover art, ownership stats, pricing, and delete controls.
 */
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

interface NominationCardProps {
    entry: LineupEntryResponseDto;
    onRemove: (gameId: number) => void;
}

/** Determine ownership badge color based on ratio of owners to total members. */
function ownershipColor(ownerCount: number, totalMembers: number): string {
    if (totalMembers === 0) return 'bg-zinc-500/20 text-zinc-400';
    const ratio = ownerCount / totalMembers;
    if (ratio >= 0.6) return 'bg-emerald-500/20 text-emerald-400';
    if (ratio >= 0.3) return 'bg-amber-500/20 text-amber-400';
    return 'bg-red-500/20 text-red-400';
}

/** Cover area with gradient overlay and ownership badge. */
function CardCover({ entry }: { entry: LineupEntryResponseDto }): JSX.Element {
    const colorClass = ownershipColor(entry.ownerCount, entry.totalMembers);
    return (
        <div className="relative aspect-[3/4] rounded-t-xl overflow-hidden">
            {entry.gameCoverUrl ? (
                <img src={entry.gameCoverUrl} alt={entry.gameName} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                    <span className="text-2xl text-dim">{entry.gameName.charAt(0)}</span>
                </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <span className={`absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] font-semibold ${colorClass}`}>
                {entry.ownerCount}/{entry.totalMembers} own
            </span>
        </div>
    );
}

/** Pricing line showing deal information. */
function PricingLine({ entry }: { entry: LineupEntryResponseDto }): JSX.Element | null {
    if (entry.itadCurrentPrice == null) return null;
    const cut = entry.itadCurrentCut ?? 0;
    const price = `$${entry.itadCurrentPrice.toFixed(2)}`;
    const label = entry.nonOwnerCount > 0 ? ` for ${entry.nonOwnerCount}` : '';
    return (
        <p className="text-xs text-muted">
            {cut > 0 && <span className="text-emerald-400">-{cut}% </span>}
            {price}{label}
        </p>
    );
}

/** Delete button visible to the nominator or operators. */
function RemoveButton({ gameId, onRemove }: { gameId: number; onRemove: (id: number) => void }): JSX.Element {
    return (
        <button
            type="button"
            onClick={() => onRemove(gameId)}
            aria-label="Remove nomination"
            className="text-xs text-red-400 hover:text-red-300 transition-colors mt-1"
        >
            Remove
        </button>
    );
}

/** Card body with game name, nominator, pricing, and optional note. */
function CardBody({ entry, canRemove, onRemove }: {
    entry: LineupEntryResponseDto;
    canRemove: boolean;
    onRemove: (id: number) => void;
}): JSX.Element {
    return (
        <div className="p-3">
            <h3 className="text-sm font-semibold text-foreground truncate">{entry.gameName}</h3>
            <p className="text-xs text-muted mt-0.5">by {entry.nominatedBy.displayName}</p>
            <PricingLine entry={entry} />
            {entry.note && (
                <p className="text-xs text-dim italic mt-1 line-clamp-2">
                    &ldquo;{entry.note}&rdquo;
                </p>
            )}
            {canRemove && <RemoveButton gameId={entry.gameId} onRemove={onRemove} />}
        </div>
    );
}

/** Single nomination card for the lineup detail grid. */
export function NominationCard({ entry, onRemove }: NominationCardProps): JSX.Element {
    const { user } = useAuth();
    const isOwner = user?.id === entry.nominatedBy.id;
    const isOp = isOperatorOrAdmin(user);
    const canRemove = isOwner || isOp;

    return (
        <div className="rounded-xl bg-panel border border-edge/50 overflow-hidden hover:border-edge transition-colors">
            <CardCover entry={entry} />
            <CardBody entry={entry} canRemove={canRemove} onRemove={onRemove} />
        </div>
    );
}
