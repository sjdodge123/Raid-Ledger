/**
 * Lineup → LFG bridge prompt on the decided page (ROK-1457, spec D8).
 *
 * `GET /lfg/bridge/:lineupId` returns the viewer's own nominations that did
 * NOT win and that they hold no live intent on. Each entry is a one-tap
 * "I'm up for <game>" that RAISES A HAND through `useJoinGroup` (`POST /lfg`
 * as the user) — the close path itself never writes an intent; the tap is
 * the only thing that does. The joined game then leaves the list on its own
 * (the server excludes games the caller holds a live intent on) and an
 * inline confirmation links to the group page, which now exists.
 *
 * Same shape and copy family as `lfg/lfg-hearted-prompt.tsx`: at most three
 * entries then `and N more`, session-scoped dismissal keyed per lineup.
 * Entries deliberately do NOT wear `data-testid="lfg-chip"` (ROK-1453 D9).
 */
import { useCallback, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LfgBridgeOfferDto } from '@raid-ledger/contract';
import { useLfgBridgeOffers } from '../../../hooks/use-lfg-bridge';
import { useJoinGroup } from '../../../hooks/use-lfg-join';

/** Session flag prefix — suffixed with the lineup id. */
const DISMISS_KEY_PREFIX = 'lfg-bridge-prompt-dismissed:';

/** How many games get their own entry before the rest are summarised. */
const MAX_ENTRIES = 3;

function dismissKey(lineupId: number): string {
    return `${DISMISS_KEY_PREFIX}${lineupId}`;
}

/** Read the session dismissal flag, tolerating storage being unavailable. */
function readDismissed(lineupId: number): boolean {
    try {
        return sessionStorage.getItem(dismissKey(lineupId)) !== null;
    } catch {
        return false;
    }
}

function writeDismissed(lineupId: number): void {
    try {
        sessionStorage.setItem(dismissKey(lineupId), '1');
    } catch {
        // Private-mode storage failure must not keep the banner on screen.
    }
}

/** The ✕ both dismiss controls use. */
function DismissX({
    label,
    onClick,
    className,
}: {
    label: string;
    onClick: () => void;
    className: string;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={`leading-none px-1 ${className}`}
        >
            ✕
        </button>
    );
}

/** The game the viewer just raised a hand for, kept for the confirmation. */
interface JoinedGame {
    name: string;
    slug: string;
}

/** One losing nomination. Clicking it creates the intent. */
function OfferEntry({
    offer,
    onJoin,
    isPending,
}: {
    offer: LfgBridgeOfferDto;
    onJoin: (offer: LfgBridgeOfferDto) => void;
    isPending: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            data-testid="lfg-bridge-prompt-game"
            aria-label={`I'm up for ${offer.gameName}`}
            disabled={isPending}
            onClick={() => onJoin(offer)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-overlay transition-colors text-sm disabled:opacity-60"
        >
            {offer.gameCoverUrl && (
                <img
                    src={offer.gameCoverUrl}
                    alt=""
                    className="w-5 h-5 rounded object-cover"
                />
            )}
            <span className="text-foreground font-medium">{offer.gameName}</span>
        </button>
    );
}

/** Inline confirmation for the game just joined, with a way into the group. */
function JoinedNotice({
    joined,
    onDismiss,
}: {
    joined: JoinedGame;
    onDismiss: () => void;
}): JSX.Element {
    return (
        <p
            data-testid="lfg-bridge-confirm"
            className="flex flex-wrap items-center gap-2 text-sm text-amber-400 mb-2"
        >
            <span>
                You&apos;re looking for {joined.name} — others can join you
            </span>
            <Link
                to={`/lfg/${joined.slug}`}
                className="underline hover:text-amber-300"
            >
                See the group
            </Link>
            <DismissX
                label="Dismiss confirmation"
                onClick={onDismiss}
                className="text-amber-400/70 hover:text-amber-300"
            />
        </p>
    );
}

/** Hand-raising state: which entry is in flight, and what to confirm after. */
function useOfferJoin() {
    const [joined, setJoined] = useState<JoinedGame | null>(null);
    const [pendingId, setPendingId] = useState<number | null>(null);
    const join = useJoinGroup();

    const onJoin = useCallback(
        (offer: LfgBridgeOfferDto) => {
            setPendingId(offer.gameId);
            join.mutate(offer.gameId, {
                onSuccess: () =>
                    setJoined({ name: offer.gameName, slug: offer.gameSlug }),
                onSettled: () => setPendingId(null),
            });
        },
        [join],
    );

    return { joined, pendingId, onJoin, clearJoined: () => setJoined(null) };
}

/** The prompt's header line plus its dismiss control. */
function PromptHeader({ onDismiss }: { onDismiss: () => void }): JSX.Element {
    return (
        <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-sm font-medium text-amber-400">
                Didn&apos;t make the cut? Say you&apos;re still up for it and
                others can join you.
            </p>
            <DismissX
                label="Dismiss"
                onClick={onDismiss}
                className="text-muted hover:text-foreground text-sm"
            />
        </div>
    );
}

/** The entry row: up to three games, then a count of the rest. */
function OfferEntries({
    offers,
    remaining,
    onJoin,
    pendingId,
}: {
    offers: LfgBridgeOfferDto[];
    remaining: number;
    onJoin: (offer: LfgBridgeOfferDto) => void;
    pendingId: number | null;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {offers.map((offer) => (
                <OfferEntry
                    key={offer.gameId}
                    offer={offer}
                    onJoin={onJoin}
                    isPending={pendingId === offer.gameId}
                />
            ))}
            {remaining > 0 && (
                <span className="text-muted text-xs">and {remaining} more</span>
            )}
        </div>
    );
}

interface LfgBridgePromptProps {
    lineupId: number;
}

/** Decided-page banner offering LFG for the viewer's losing nominations. */
export function LfgBridgePrompt({
    lineupId,
}: LfgBridgePromptProps): JSX.Element | null {
    const { data } = useLfgBridgeOffers(lineupId);
    const [dismissed, setDismissed] = useState<boolean>(() =>
        readDismissed(lineupId),
    );
    const { joined, pendingId, onJoin, clearJoined } = useOfferJoin();

    const offers = data ?? [];
    // The confirmation outlives the list: joining the last losing game empties
    // it, and the user should still be told what happened.
    if (dismissed || (offers.length === 0 && !joined)) return null;

    const shown = offers.slice(0, MAX_ENTRIES);
    const remaining = offers.length - shown.length;

    const dismiss = (): void => {
        writeDismissed(lineupId);
        setDismissed(true);
    };

    return (
        <div
            data-testid="lfg-bridge-prompt"
            className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"
        >
            <PromptHeader onDismiss={dismiss} />
            {joined && <JoinedNotice joined={joined} onDismiss={clearJoined} />}
            <OfferEntries
                offers={shown}
                remaining={remaining}
                onJoin={onJoin}
                pendingId={pendingId}
            />
        </div>
    );
}
