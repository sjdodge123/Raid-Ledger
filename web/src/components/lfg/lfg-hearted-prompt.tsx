/**
 * Cold-start prompt for the games page (ROK-1453 AC6, spec decision D7).
 *
 * `GET /lfg/hearted` returns the caller's hearted games that they have no live
 * intent on — the nudge is "you already like these, say you're up for one".
 * At most three entries, then `and N more`; dismissal is session-scoped so it
 * comes back tomorrow but not on the next page view.
 *
 * `and N more` is a DISCLOSURE, not a label (ROK-1502). It used to be a plain
 * `<span>` — the prompt named games the viewer could not reach, which is the
 * one thing a cold-start nudge must not do. Clicking it reveals the whole
 * list, bounded by `LFG_LIST_LIMIT` (200) at the server; the revealed row
 * scrolls rather than growing the banner to fit 200 chips.
 *
 * Clicking an entry ASKS WHEN (ROK-1479 D2). It used to raise the hand
 * immediately on a 14-day horizon; a `now` intent lapses in 30 or 60 minutes,
 * so the horizon has to be the user's choice rather than an assumption. The
 * second click is the one that posts.
 *
 * Before that it used to link to
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
import {
    LfgUrgencyChoice,
    type LfgUrgencyPick,
} from './lfg-urgency-choice';

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

/** One hearted game. Clicking it opens the urgency choice (ROK-1479). */
function PromptEntry({
    game,
    onChoose,
    isChoosing,
    isPending,
}: {
    game: LfgHeartedGameDto;
    onChoose: (game: LfgHeartedGameDto) => void;
    isChoosing: boolean;
    isPending: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            data-testid="lfg-hearted-prompt-game"
            aria-label={`I'm up for ${game.gameName}`}
            aria-expanded={isChoosing}
            disabled={isPending}
            onClick={() => onChoose(game)}
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

/**
 * Hand-raising state: which entry is being chosen for, which is in flight, and
 * what to confirm after.
 *
 * `onPick` spreads the pick rather than reading `pick.ttlMinutes` explicitly,
 * so a `week` pick contributes NO `ttlMinutes` key to the mutation variables —
 * A2 makes the contract reject the pair outright instead of dropping the TTL.
 */
function usePromptJoin() {
    const [joined, setJoined] = useState<JoinedGame | null>(null);
    const [choosing, setChoosing] = useState<LfgHeartedGameDto | null>(null);
    const [pendingId, setPendingId] = useState<number | null>(null);
    const join = useJoinGroup();

    const onPick = useCallback(
        (pick: LfgUrgencyPick) => {
            const game = choosing;
            if (!game) return;
            setChoosing(null);
            setPendingId(game.gameId);
            join.mutate(
                { gameId: game.gameId, ...pick },
                {
                    onSuccess: () =>
                        setJoined({ name: game.gameName, slug: game.gameSlug }),
                    onSettled: () => setPendingId(null),
                },
            );
        },
        [choosing, join],
    );

    return {
        joined,
        choosing,
        pendingId,
        onChoose: setChoosing,
        onPick,
        clearJoined: () => setJoined(null),
    };
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

/**
 * The disclosure that used to be the dead text `and N more` (ROK-1502).
 *
 * It keeps that exact wording collapsed — the reporter's complaint was that
 * the sentence promised games it would not hand over, not that the sentence
 * was wrong — and only gains the affordances that make it a control: it is a
 * `button`, it carries `aria-expanded`, and the caret says which way it goes.
 *
 * The caret is `aria-hidden` and the accessible name spells the action out,
 * because "and 21 more ↓" read aloud is not an instruction.
 */
function MoreToggle({
    hidden,
    expanded,
    onToggle,
}: {
    hidden: number;
    expanded: boolean;
    onToggle: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            data-testid="lfg-hearted-prompt-more"
            aria-expanded={expanded}
            aria-label={
                expanded
                    ? 'Show fewer hearted games'
                    : `Show ${String(hidden)} more hearted games`
            }
            onClick={onToggle}
            className="text-muted hover:text-foreground text-xs underline underline-offset-2 transition-colors"
        >
            {expanded ? 'Show fewer' : `and ${String(hidden)} more`}{' '}
            <span aria-hidden="true">{expanded ? '↑' : '↓'}</span>
        </button>
    );
}

/**
 * The chips themselves, capped in height only while expanded.
 *
 * `GET /lfg/hearted` is bounded by `LFG_LIST_LIMIT` (200) server-side, so
 * "every game" is at most 200 entries — enough to push the whole games page
 * down the screen if the banner were allowed to grow to fit them.
 */
function EntryRow({
    games,
    expanded,
    onChoose,
    choosingId,
    pendingId,
}: {
    games: LfgHeartedGameDto[];
    expanded: boolean;
    onChoose: (game: LfgHeartedGameDto) => void;
    choosingId: number | null;
    pendingId: number | null;
}): JSX.Element {
    return (
        <div
            className={`flex flex-wrap items-center gap-2${
                expanded ? ' max-h-56 overflow-y-auto' : ''
            }`}
        >
            {games.map((game) => (
                <PromptEntry
                    key={game.gameId}
                    game={game}
                    onChoose={onChoose}
                    isChoosing={choosingId === game.gameId}
                    isPending={pendingId === game.gameId}
                />
            ))}
        </div>
    );
}

/**
 * The entry row plus its disclosure.
 *
 * The toggle deliberately sits OUTSIDE {@link EntryRow}'s scroll box: inside
 * it, collapsing a 200-game list would mean scrolling to the bottom to find
 * the control that collapses it.
 */
function PromptEntries({
    games,
    hidden,
    expanded,
    onToggle,
    onChoose,
    choosingId,
    pendingId,
}: {
    games: LfgHeartedGameDto[];
    hidden: number;
    expanded: boolean;
    onToggle: () => void;
    onChoose: (game: LfgHeartedGameDto) => void;
    choosingId: number | null;
    pendingId: number | null;
}): JSX.Element {
    return (
        <div>
            <EntryRow
                games={games}
                expanded={expanded}
                onChoose={onChoose}
                choosingId={choosingId}
                pendingId={pendingId}
            />
            {hidden > 0 && (
                <div className="mt-2">
                    <MoreToggle
                        hidden={hidden}
                        expanded={expanded}
                        onToggle={onToggle}
                    />
                </div>
            )}
        </div>
    );
}

/** Games-page banner nudging the viewer to raise their hand for a heart. */
export function LfgHeartedPrompt(): JSX.Element | null {
    const { data } = useLfgHearted();
    const [dismissed, setDismissed] = useState<boolean>(readDismissed);
    const [expanded, setExpanded] = useState(false);
    const { joined, choosing, pendingId, onChoose, onPick, clearJoined } =
        usePromptJoin();

    const games = data ?? [];
    // The confirmation outlives the list: joining the last hearted game empties
    // it, and the user should still be told what happened.
    if (dismissed || (games.length === 0 && !joined)) return null;

    // `hidden` is derived from the FULL list, never from what is on screen, so
    // that joining a game while expanded shrinks the list and retires the
    // toggle on its own once three or fewer hearts are left.
    const hidden = Math.max(0, games.length - MAX_ENTRIES);
    const shown = expanded ? games : games.slice(0, MAX_ENTRIES);

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
                hidden={hidden}
                expanded={expanded}
                onToggle={() => setExpanded((v) => !v)}
                onChoose={onChoose}
                choosingId={choosing?.gameId ?? null}
                pendingId={pendingId}
            />
            {choosing && (
                <div className="mt-3">
                    <LfgUrgencyChoice
                        label={choosing.gameName}
                        disabled={pendingId !== null}
                        onPick={onPick}
                    />
                </div>
            )}
        </div>
    );
}
