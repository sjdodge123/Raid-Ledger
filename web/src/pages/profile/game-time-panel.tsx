/**
 * The profile's game time — one shape per viewport (ROK-1569 AC4 → ROK-1579).
 *
 * Below 768px the seven-column grid is unusable. ROK-1569 gave the phone the
 * check's own editor (`PhoneWeekCheckStep`) INLINE, inside a 980px-tall box
 * that dominated the page. ROK-1579 splits that in two: the page shows a
 * summary card — the saved week in words, any absence, how old the
 * confirmation is — and "Edit my week" opens the SAME bottom drawer the poll's
 * game-time check uses (`GameTimeCheckSheet`). One editor, one drawer, two
 * entry points; the profile's tab menu lands on this page and therefore on the
 * same drawer.
 *
 * Saving inside the drawer collapses it (the editor reports done through
 * `useStepOneDone()`) and the card re-reads `useGameTime()`, so the new week is
 * on screen without a reload. Desktop keeps `GameTimePanel` untouched.
 *
 * No new pattern: the card is the page's own `bg-surface`/`border-edge-subtle`
 * panel, the button is the shared `ANSWER_PRIMARY` recipe, the drawer is the
 * shipped sheet. Every colour is a `--color-*` token.
 */
import { useState, type JSX } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useGameTime, useGameTimeAbsences } from '../../hooks/use-game-time';
import { GameTimePanel } from '../../components/features/game-time';
import { ANSWER_PRIMARY, gameTimeCheckPrompt } from '../../components/features/game-time/game-time-check-copy';
import { PhoneWeekCheckStep } from '../../components/features/game-time/phone/PhoneWeekCheckStep';
import { PROFILE_HOURS } from '../../components/features/game-time/phone/phone-week-check.helpers';
import { NO_WEEK, summariseAbsences, summariseWeek } from '../../components/features/game-time/phone/phone-week-summary';
import { useMediaQuery } from '../../hooks/use-media-query';
import { GameTimeCheckSheet } from '../scheduling/GameTimeCheckSheet';
import { safeReturnPath } from './game-time-return';

/** ROK-1564: "Edit my week" on a scheduling poll lands here with `?return=`. */
function BackToPoll({ to }: { to: string }) {
    return (
        <Link
            to={to}
            data-testid="game-time-return-link"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
            ← Back to the poll
        </Link>
    );
}

/** The saved week, any absence, and how old the confirmation is. */
function SummaryLines(): JSX.Element {
    const { data } = useGameTime();
    const week = summariseWeek(data?.slots ?? []);
    // Current + future absences (the composite view's list is week-bounded and
    // includes past ones — review MAJOR 1).
    const { data: absences } = useGameTimeAbsences();
    const away = summariseAbsences(absences ?? []);
    return (
        <>
            <p data-testid="profile-game-time-week" className="text-base text-foreground">
                {week}
            </p>
            {away && (
                <p data-testid="profile-game-time-away" className="text-sm text-muted">
                    {away}
                </p>
            )}
            {week !== NO_WEEK && (
                <p data-testid="profile-game-time-freshness" className="text-sm text-muted">
                    {gameTimeCheckPrompt(data?.gameTimeAgeDays, true)}
                </p>
            )}
        </>
    );
}

/** What is saved, in words, plus the one button that opens the editor. */
function GameTimeSummaryCard({ onEdit }: { onEdit: () => void }): JSX.Element {
    return (
        <section
            data-testid="profile-game-time-summary"
            className="flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface p-4"
        >
            <h2 className="text-lg font-semibold text-foreground">My Game Time</h2>
            <SummaryLines />
            <button
                type="button"
                data-testid="profile-game-time-edit"
                onClick={onEdit}
                className={`${ANSWER_PRIMARY} text-center`}
            >
                Edit my week
            </button>
        </section>
    );
}

export function ProfileGameTimePanel() {
    const { isAuthenticated } = useAuth();
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [params] = useSearchParams();
    const returnTo = safeReturnPath(params.get('return'));
    // A poll's "Edit my week" deep link means "take me to the editor", so that
    // flow still lands IN the drawer rather than on the summary (ROK-1564).
    const [editing, setEditing] = useState<boolean>(() => returnTo !== null);

    return (
        <div className="space-y-6">
            {returnTo && <BackToPoll to={returnTo} />}
            {isDesktop ? (
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <GameTimePanel mode="profile" rolling enabled={isAuthenticated} />
                </div>
            ) : (
                <>
                    <GameTimeSummaryCard onEdit={() => setEditing(true)} />
                    {/* Mounted only while open so a re-opened drawer starts fresh. */}
                    {editing && (
                        <GameTimeCheckSheet
                            isOpen
                            title="My game time"
                            onClose={() => setEditing(false)}
                            body={<PhoneWeekCheckStep variant="profile" hours={PROFILE_HOURS} />}
                        />
                    )}
                </>
            )}
        </div>
    );
}
