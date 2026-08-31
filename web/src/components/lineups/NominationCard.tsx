/**
 * Nomination card for the Community Lineup detail grid (ROK-935).
 * Matches the Figma "Lineup Detail" card layout.
 */
import type { JSX } from "react";
import { Link } from "react-router-dom";
import type { LineupEntryResponseDto } from "@raid-ledger/contract";
import { useAuth, isOperatorOrAdmin } from "../../hooks/use-auth";
import { ConfirmationPill } from "../common/ConfirmationPill";
import { resolveEffectiveOnlineMax } from "./coop-fit";

interface NominationCardProps {
  entry: LineupEntryResponseDto;
  onRemove: (gameId: number) => void;
  /**
   * ROK-1444: current eligible-player count. When the roster grows past a
   * nominated game's co-op capacity the card is flagged, so the group can
   * see which of their existing picks no longer fit before voting opens.
   */
  participantCount?: number;
}

/** Ownership badge color: green ≥60%, amber ≥30%, red <30%. */
function ownershipBadgeClass(count: number, total: number): string {
  if (total === 0) return "bg-zinc-500/90";
  const r = count / total;
  if (r >= 0.6) return "bg-emerald-500/90";
  if (r >= 0.3) return "bg-amber-500/90";
  return "bg-red-500/90";
}

/** Cover image with gradient, badges, title overlay. */
function CardCover({ entry }: { entry: LineupEntryResponseDto }): JSX.Element {
  const badgeClass = ownershipBadgeClass(entry.ownerCount, entry.totalMembers);
  const onSale = (entry.itadCurrentCut ?? 0) > 0;

  return (
    <div className="relative h-48 overflow-hidden">
      {entry.gameCoverUrl ? (
        <img
          src={entry.gameCoverUrl}
          alt={entry.gameName}
          className="w-full h-full object-cover"
        />
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

      {/* Top-right: ownership tally */}
      <span
        className={`absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-bold text-white rounded ${badgeClass}`}
      >
        +{entry.ownerCount}
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
  const cut =
    (entry.itadCurrentCut ?? 0) > 0 ? ` (-${entry.itadCurrentCut}%)` : "";
  const forCount = entry.nonOwnerCount > 0 ? ` for ${entry.nonOwnerCount}` : "";
  return `${price}${cut}${forCount}`;
}

/** Card body: nominator + price on one line, optional note below. */
function CardBody({
  entry,
  canRemove,
  isMine,
  onRemove,
}: {
  entry: LineupEntryResponseDto;
  canRemove: boolean;
  isMine: boolean;
  onRemove: (id: number) => void;
}): JSX.Element {
  const priceText = formatPrice(entry);
  return (
    <div className="px-2.5 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-dim">
          by{" "}
          <span className="text-secondary">
            {entry.nominatedBy.displayName}
          </span>
        </span>
        {priceText && (
          <span className="text-[11px] text-emerald-400">{priceText}</span>
        )}
      </div>
      {isMine && (
        <div className="mt-1.5">
          <ConfirmationPill variant="text" size="sm">
            Your nomination
          </ConfirmationPill>
        </div>
      )}
      {entry.note && (
        <p className="text-[10px] text-dim italic mt-1 line-clamp-2">
          &ldquo;{entry.note}&rdquo;
        </p>
      )}
      {canRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(entry.gameId);
          }}
          className="text-[10px] text-red-400/60 hover:text-red-400 mt-1 transition-colors"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * ROK-1444: does this nomination no longer fit the group?
 *
 * Reuses ROK-1400's rule verbatim so this card and the NominateModal search
 * row never disagree: strictly Co-Optimus-verified, online max only. A
 * never-synced game resolves to null and is NOT flagged — an absent signal is
 * honest, an invented one is not. Advisory only, exactly like the search-row
 * warning: it never hides, disables or blocks anything (operator decision,
 * "soft filter, no hard gate").
 */
function useRosterFit(
  entry: LineupEntryResponseDto,
  participantCount: number | undefined,
): { tooSmall: boolean; max: number | null } {
  const max = resolveEffectiveOnlineMax(entry.cooptimusOnlineMax);
  return {
    tooSmall: participantCount != null && max != null && max < participantCount,
    max,
  };
}

/** Single nomination card. */
export function NominationCard({
  entry,
  onRemove,
  participantCount,
}: NominationCardProps): JSX.Element {
  const { user } = useAuth();
  const isMine = !!user && entry.nominatedBy.id === user.id;
  const canRemove = isMine || isOperatorOrAdmin(user);
  const { tooSmall, max } = useRosterFit(entry, participantCount);

  return (
    <Link
      to={`/games/${entry.gameId}`}
      data-testid={tooSmall ? "nomination-card-too-small" : "nomination-card"}
      className={`block rounded-xl bg-surface overflow-hidden hover:shadow-lg transition-all ${
        tooSmall
          ? "border border-amber-500/70 ring-1 ring-amber-500/30 hover:border-amber-400"
          : "border border-edge hover:border-emerald-500/50"
      }`}
    >
      <CardCover entry={entry} />
      {tooSmall && (
        <p
          data-testid="nomination-fit-warning"
          className="px-2.5 pt-1.5 text-[10px] font-medium text-amber-400"
        >
          Fits {max} online · group is {participantCount}
        </p>
      )}
      <CardBody
        entry={entry}
        canRemove={canRemove}
        isMine={isMine}
        onRemove={onRemove}
      />
    </Link>
  );
}
