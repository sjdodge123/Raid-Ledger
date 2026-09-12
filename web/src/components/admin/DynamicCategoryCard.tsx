/**
 * Admin card for a single LLM-proposed discovery category (ROK-567).
 *
 * Shows name, description, a compact 7-axis theme-vector strip, a short
 * candidate-game summary, and action buttons (Approve / Reject / Edit).
 *
 * The status is reflected on the root element via `data-status` so the
 * Playwright smoke test can poll for transitions without relying on
 * re-fetch timing.
 */
import type { JSX } from 'react';
import type {
    AdminCandidateGameDto,
    AdminCategoryListSuggestionDto,
    DiscoveryCategorySuggestionDto,
} from '@raid-ledger/contract';

/** Axis order is locked by contract: [co_op, pvp, rpg, survival, strategy, social, mmo]. */
const AXIS_LABELS = ['Co-op', 'PvP', 'RPG', 'Surv', 'Strat', 'Social', 'MMO'];

/** Max thumbnails rendered inline — any extras roll up into a "+N more" tag. */
const MAX_INLINE_THUMBS = 8;

interface DynamicCategoryCardProps {
    suggestion: AdminCategoryListSuggestionDto;
    onApprove?: (id: string) => void;
    onReject?: (id: string) => void;
    onEdit?: (suggestion: DiscoveryCategorySuggestionDto) => void;
    isBusy?: boolean;
}

/** Pixel-height track for each bar. % heights don't resolve without a fixed
 * parent height — using px + a dedicated track per bar sidesteps that. */
const BAR_TRACK_HEIGHT_PX = 40;

/** One labelled magnitude bar of the theme strip (ROK-1530 D4). */
function ThemeBar({ label, raw }: { label: string; raw: number }) {
    const mag = Math.min(1, Math.abs(raw));
    const heightPx = Math.max(2, Math.round(mag * BAR_TRACK_HEIGHT_PX));
    return (
        <div
            className="flex flex-col items-center flex-1 min-w-0"
            title={`${label}: ${raw.toFixed(2)}`}
        >
            <div
                className="w-full flex items-end"
                style={{ height: `${BAR_TRACK_HEIGHT_PX}px` }}
            >
                <div
                    className={`w-full rounded-t ${raw >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                    style={{ height: `${heightPx}px` }}
                />
            </div>
            <span className="text-[9px] text-muted truncate mt-1 w-full text-center">
                {label}
            </span>
        </div>
    );
}

function ThemeStrip({ vector }: { vector: number[] }) {
    return (
        <div
            className="rounded-md border border-edge/40 bg-overlay/40 px-3 py-2"
            role="img"
            aria-label={`Theme vector: ${vector
                .map((v, i) => `${AXIS_LABELS[i]} ${v.toFixed(2)}`)
                .join(', ')}`}
        >
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                Theme weights
            </div>
            <div className="flex gap-1">
                {vector.slice(0, 7).map((raw, i) => (
                    <ThemeBar
                        key={AXIS_LABELS[i]}
                        label={AXIS_LABELS[i]}
                        raw={raw}
                    />
                ))}
            </div>
        </div>
    );
}

function CandidateThumb({ game }: { game: AdminCandidateGameDto }) {
    return (
        <div className="flex flex-col items-center gap-1 w-16 shrink-0">
            {game.coverUrl ? (
                <img
                    src={game.coverUrl}
                    alt={game.name}
                    loading="lazy"
                    className="w-16 h-20 object-cover rounded border border-edge/50"
                />
            ) : (
                <div className="w-16 h-20 rounded border border-edge/50 bg-overlay flex items-center justify-center text-[10px] text-muted px-1 text-center">
                    {game.name.slice(0, 3).toUpperCase()}
                </div>
            )}
            <span className="text-[10px] text-muted truncate w-full text-center">
                {game.name}
            </span>
        </div>
    );
}

/** Horizontal thumb strip plus the "+N more" overflow tile (ROK-1530 D5). */
function CandidateThumbRow({
    ids,
    games,
}: {
    ids: number[];
    games: AdminCandidateGameDto[];
}) {
    const visible = games.slice(0, MAX_INLINE_THUMBS);
    const extra = ids.length - visible.length;
    return (
        <div
            data-testid="dynamic-category-candidates"
            className="flex gap-2 overflow-x-auto py-1"
        >
            {visible.map((g) => (
                <CandidateThumb key={g.id} game={g} />
            ))}
            {extra > 0 && (
                <div className="flex flex-col items-center justify-center w-16 shrink-0 text-xs text-muted border border-dashed border-edge/50 rounded h-20">
                    +{extra} more
                </div>
            )}
        </div>
    );
}

function CandidatePreview({
    ids,
    games,
}: {
    ids: number[];
    games: AdminCandidateGameDto[] | undefined;
}) {
    if (ids.length === 0) {
        return (
            <p className="text-xs text-amber-400">
                No candidate games matched — likely waiting on taste vectors.
            </p>
        );
    }
    if (!games || games.length === 0) {
        return (
            <p className="text-xs text-muted">
                {`${ids.length} candidate game${ids.length === 1 ? '' : 's'}`}
            </p>
        );
    }
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                Candidate games ({ids.length})
            </div>
            <CandidateThumbRow ids={ids} games={games} />
        </div>
    );
}

interface CardAction {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    className: string;
}

/** Per-action button of the card footer — variant carries the styling (ROK-1530 D6). */
function CardActionButton({
    label,
    onClick,
    disabled,
    className,
}: CardAction): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${className}`}
        >
            {label}
        </button>
    );
}

const APPROVE_CLASSES =
    'bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground';
const REJECT_CLASSES =
    'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/50 disabled:opacity-50 disabled:cursor-not-allowed';
const EDIT_CLASSES =
    'bg-overlay hover:bg-faint text-foreground border border-edge disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Footer action descriptors. Approve/Reject only apply to a pending
 * suggestion; Edit stays available once it has been decided.
 */
function cardActions({
    suggestion,
    onApprove,
    onReject,
    onEdit,
    isBusy,
}: DynamicCategoryCardProps): CardAction[] {
    const decided = isBusy || suggestion.status !== 'pending';
    return [
        {
            label: 'Approve',
            onClick: () => onApprove?.(suggestion.id),
            disabled: decided,
            className: APPROVE_CLASSES,
        },
        {
            label: 'Reject',
            onClick: () => onReject?.(suggestion.id),
            disabled: decided,
            className: REJECT_CLASSES,
        },
        {
            label: 'Edit',
            onClick: () => onEdit?.(suggestion),
            disabled: isBusy,
            className: EDIT_CLASSES,
        },
    ];
}

function ActionButtons(props: DynamicCategoryCardProps): JSX.Element {
    return (
        <div className="flex flex-wrap gap-2 mt-3">
            {cardActions(props).map((a) => (
                <CardActionButton key={a.label} {...a} />
            ))}
        </div>
    );
}

export function DynamicCategoryCard(
    props: DynamicCategoryCardProps,
): JSX.Element {
    const { suggestion } = props;
    return (
        <div
            data-testid="dynamic-category-card"
            data-status={suggestion.status}
            className="bg-panel/50 rounded-xl border border-edge/50 p-4 space-y-3"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground truncate">
                        {suggestion.name}
                    </h3>
                    <p className="text-sm text-muted mt-1 line-clamp-3">
                        {suggestion.description}
                    </p>
                </div>
                <span className="text-xs uppercase tracking-wider text-muted shrink-0">
                    {suggestion.categoryType.replace('_', ' ')}
                </span>
            </div>
            <ThemeStrip vector={suggestion.themeVector} />
            <CandidatePreview
                ids={suggestion.candidateGameIds}
                games={suggestion.candidateGames}
            />
            <ActionButtons {...props} />
        </div>
    );
}
