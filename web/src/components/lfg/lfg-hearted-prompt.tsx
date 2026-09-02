/**
 * Cold-start prompt for the games page (ROK-1453 AC6, spec decision D7).
 *
 * `GET /lfg/hearted` returns the caller's hearted games that they have no live
 * intent on — the nudge is "you already like these, say you're up for one".
 * At most three entries, then `and N more`; dismissal is session-scoped so it
 * comes back tomorrow but not on the next page view.
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
import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LfgHeartedGameDto } from '@raid-ledger/contract';
import { useLfgHearted } from '../../hooks/use-lfg-hearted';

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

/** One hearted game, linking to its LFG page. */
function PromptEntry({ game }: { game: LfgHeartedGameDto }): JSX.Element {
    return (
        <Link
            to={`/lfg/${game.gameSlug}`}
            data-testid="lfg-hearted-prompt-game"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-overlay transition-colors text-sm"
        >
            {game.gameCoverUrl && (
                <img
                    src={game.gameCoverUrl}
                    alt=""
                    className="w-5 h-5 rounded object-cover"
                />
            )}
            <span className="text-foreground font-medium">{game.gameName}</span>
        </Link>
    );
}

/** Games-page banner nudging the viewer to raise their hand for a heart. */
export function LfgHeartedPrompt(): JSX.Element | null {
    const { data } = useLfgHearted();
    const [dismissed, setDismissed] = useState<boolean>(readDismissed);

    const games = data ?? [];
    if (dismissed || games.length === 0) return null;

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
            <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-sm font-medium text-amber-300">
                    Up for one of your hearted games? Say so and others can join
                    you.
                </p>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={dismiss}
                    className="text-muted hover:text-foreground text-sm leading-none px-1"
                >
                    ✕
                </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {shown.map((game) => (
                    <PromptEntry key={game.gameId} game={game} />
                ))}
                {remaining > 0 && (
                    <span className="text-muted text-xs">
                        and {remaining} more
                    </span>
                )}
            </div>
        </div>
    );
}
