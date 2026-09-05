/**
 * Cold-start prompt for the games page (ROK-1453 AC6, spec decision D7).
 *
 * `GET /lfg/hearted` returns the caller's hearted games that they have no live
 * intent on — the nudge is "you already like these, say you're up for one".
 * At most three entries, then `and N more`; dismissal is session-scoped so it
 * comes back tomorrow but not on the next page view.
 *
 * Clicking an entry RAISES A HAND (operator re-walk). It used to link to
 * `/lfg/<slug>`, which sent the user to a group page nobody had joined — the
 * copy promises "say so and others can join you", so the click has to be the
 * saying-so. The joined game then leaves the list on its own (the server
 * excludes games the caller holds a live intent on) and an inline confirmation
 * offers the group page, which now actually exists.
 *
 * LAYOUT (operator walk): the games-page banner stack sits INSIDE
 * `max-w-7xl mx-auto px-4 py-8` (`games-page.tsx:99-101`), and its sibling
 * `LineupBanner` carries no horizontal margin of its own — so neither does
 * this. Padding and radius stay on the events banners' `p-4 rounded-xl`.
 *
 * Entries deliberately do NOT wear `data-testid="lfg-chip"` — the tile-chip
 * absence assertions in the smoke spec are page-scoped and unqualified, and a
 * prompt entry wearing that testid would make them unprovable (D9).
 */
import { useCallback, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LfgHeartedGameDto } from '@raid-ledger/contract';
import { useLfgHearted } from '../../hooks/use-lfg-hearted';
import { useJoinGroup } from '../../hooks/use-lfg-join';

/** Session flag the smoke spec reloads against — do not rename. */
const DISMISS_KEY = 'lfg-hearted-prompt-dismissed';

/** How many games get their own entry before the rest are summarised. */
const MAX_ENTRIES = 3;

/** Read the session dismissal flag, tolerating storage being unavailable. */
function readDismissed(): boolean {
    try {
        return sessionStorage.getItem(DISMISS_KEY) !== null;
    } catch {
        return false;
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

/** One hearted game. Clicking it creates the intent. */
function PromptEntry({
    game,
    onJoin,
    isPending,
}: {
    game: LfgHeartedGameDto;
    onJoin: (game: LfgHeartedGameDto) => void;
    isPending: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            data-testid="lfg-hearted-prompt-game"
            aria-label={`I'm up for ${game.gameName}`}
            disabled={isPending}
            onClick={() => onJoin(game)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-overlay transition-colors text-sm disabled:opacity-60"
        >
            {game.gameCoverUrl && (
                <img
                    src={game.gameCoverUrl}
                    alt=""
                    className="w-5 h-5 rounded object-cover"
                />
            )}
            <span className="text-foreground font-medium">{game.gameName}</span>
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
            data-testid="lfg-hearted-confirm"
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
function usePromptJoin() {
    const [joined, setJoined] = useState<JoinedGame | null>(null);
    const [pendingId, setPendingId] = useState<number | null>(null);
    const join = useJoinGroup();

    const onJoin = useCallback(
        (game: LfgHeartedGameDto) => {
            setPendingId(game.gameId);
            join.mutate(game.gameId, {
                onSuccess: () =>
                    setJoined({ name: game.gameName, slug: game.gameSlug }),
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
                Up for one of your hearted games? Say so and others can join
                you.
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
function PromptEntries({
    games,
    remaining,
    onJoin,
    pendingId,
}: {
    games: LfgHeartedGameDto[];
    remaining: number;
    onJoin: (game: LfgHeartedGameDto) => void;
    pendingId: number | null;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {games.map((game) => (
                <PromptEntry
                    key={game.gameId}
                    game={game}
                    onJoin={onJoin}
                    isPending={pendingId === game.gameId}
                />
            ))}
            {remaining > 0 && (
                <span className="text-muted text-xs">and {remaining} more</span>
            )}
        </div>
    );
}

/** Games-page banner nudging the viewer to raise their hand for a heart. */
export function LfgHeartedPrompt(): JSX.Element | null {
    const { data } = useLfgHearted();
    const [dismissed, setDismissed] = useState<boolean>(readDismissed);
    const { joined, pendingId, onJoin, clearJoined } = usePromptJoin();

    const games = data ?? [];
    // The confirmation outlives the list: joining the last hearted game empties
    // it, and the user should still be told what happened.
    if (dismissed || (games.length === 0 && !joined)) return null;

    const shown = games.slice(0, MAX_ENTRIES);
    const remaining = games.length - shown.length;

    const dismiss = (): void => {
        try {
            sessionStorage.setItem(DISMISS_KEY, '1');
        } catch {
            // Private-mode storage failure must not keep the banner on screen.
        }
        setDismissed(true);
    };

    return (
        <div
            data-testid="lfg-hearted-prompt"
            className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"
        >
            <PromptHeader onDismiss={dismiss} />
            {joined && <JoinedNotice joined={joined} onDismiss={clearJoined} />}
            <PromptEntries
                games={shown}
                remaining={remaining}
                onJoin={onJoin}
                pendingId={pendingId}
            />
        </div>
    );
}
