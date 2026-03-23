/**
 * Nomination card for the Community Lineup detail grid (ROK-935).
 * Matches the Figma "Lineup Detail" card layout.
 */
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

interface NominationCardProps {
    entry: LineupEntryResponseDto;
    onRemove: (gameId: number) => void;
}

/** Ownership badge color: green ≥60%, amber ≥30%, red <30%. */
function ownershipBadgeClass(count: number, total: number): string {
    if (total === 0) return 'bg-zinc-500/90';
    const r = count / total;
    if (r >= 0.6) return 'bg-emerald-500/90';
    if (r >= 0.3) return 'bg-amber-500/90';
    return 'bg-red-500/90';
}

/** Cover image with gradient, badges, title overlay. */
function CardCover({ entry }: { entry: LineupEntryResponseDto }): JSX.Element {
    const badgeClass = ownershipBadgeClass(entry.ownerCount, entry.totalMembers);
    const onSale = (entry.itadCurrentCut ?? 0) > 0;

    return (
        <div className="relative h-28 overflow-hidden">
            {entry.gameCoverUrl ? (
                <img src={entry.gameCoverUrl} alt="" className="w-full h-full object-cover object-top" />
            ) : (
                <div className="w-full h-full bg-zinc-800" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-surface/90 via-surface/40 to-transparent" />

            {/* Top-left: carried over badge */}
            {entry.carriedOver && (
                <span className="absolute top-2 left-2 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-zinc-500/40 text-secondary border border-zinc-500/30">
                    Carried Over
                </span>
            )}

            {/* Top-right: ownership pill */}
            <span className={`absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-bold text-white rounded ${badgeClass}`}>
                {entry.ownerCount}/{entry.totalMembers}
            </span>

            {/* On Sale badge below ownership */}
            {onSale && (
                <span className="absolute top-8 right-2 px-1.5 py-0.5 text-[9px] font-medium rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    On Sale
                </span>
            )}

            {/* Game title overlaid at bottom of cover */}
            <h3 className="absolute bottom-2 left-2.5 right-2.5 text-sm font-semibold text-white truncate">
                {entry.gameName}
            </h3>
        </div>
    );
}

/** Format price display: "$9.99 for 1" or "$14.99 (-50%) for 2". */
function formatPrice(entry: LineupEntryResponseDto): string | null {
    if (entry.itadCurrentPrice == null) return null;
    const price = `$${entry.itadCurrentPrice.toFixed(2)}`;
    const cut = (entry.itadCurrentCut ?? 0) > 0 ? ` (-${entry.itadCurrentCut}%)` : '';
    const forCount = entry.nonOwnerCount > 0 ? ` for ${entry.nonOwnerCount}` : '';
    return `${price}${cut}${forCount}`;
}

/** Card body: nominator + price on one line, optional note below. */
function CardBody({ entry, canRemove, onRemove }: {
    entry: LineupEntryResponseDto;
    canRemove: boolean;
    onRemove: (id: number) => void;
}): JSX.Element {
    const priceText = formatPrice(entry);
    return (
        <div className="px-2.5 py-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] text-dim">
                    by <span className="text-secondary">{entry.nominatedBy.displayName}</span>
                </span>
                {priceText && (
                    <span className="text-[11px] text-emerald-400">{priceText}</span>
                )}
            </div>
            {entry.note && (
                <p className="text-[10px] text-dim italic mt-1 line-clamp-2">&ldquo;{entry.note}&rdquo;</p>
            )}
            {canRemove && (
                <button type="button" onClick={() => onRemove(entry.gameId)}
                    className="text-[10px] text-red-400/60 hover:text-red-400 mt-1 transition-colors"
                >Remove</button>
            )}
        </div>
    );
}

/** Single nomination card. */
export function NominationCard({ entry, onRemove }: NominationCardProps): JSX.Element {
    const { user } = useAuth();
    const canRemove = user?.id === entry.nominatedBy.id || isOperatorOrAdmin(user);

    return (
        <div className="rounded-xl bg-surface border border-edge overflow-hidden hover:border-edge/80 transition-colors">
            <CardCover entry={entry} />
            <CardBody entry={entry} canRemove={canRemove} onRemove={onRemove} />
        </div>
    );
}
