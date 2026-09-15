/**
 * The profile's game time editor — one shape per viewport (ROK-1569 AC4).
 *
 * Below 768px the seven-column grid is unusable, so the phone gets the SAME
 * editor the poll's game-time check uses (`PhoneWeekCheckStep`, Option A):
 * one day on screen, paged or swiped, the "I'm away…" absence row and the
 * sticky "Save my week" — no prompt, no "Same as last week", no Skip, because
 * nobody asked the viewer a question here. It edits the profile's full
 * 9am–1am range (`PROFILE_HOURS`), not the check's evening window. Desktop
 * keeps `GameTimePanel` untouched.
 *
 * The editor is `h-full`, so this mount supplies a bounded height: tall
 * enough for 44px rows across 17 hours (the PAGE scrolls, the editor never
 * does), capped to the viewport on a large phone.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { GameTimePanel } from '../../components/features/game-time';
import { PhoneWeekCheckStep } from '../../components/features/game-time/phone/PhoneWeekCheckStep';
import { PROFILE_HOURS } from '../../components/features/game-time/phone/phone-week-check.helpers';
import { useMediaQuery } from '../../hooks/use-media-query';
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

export function ProfileGameTimePanel() {
    const { isAuthenticated } = useAuth();
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [params] = useSearchParams();
    const returnTo = safeReturnPath(params.get('return'));

    return (
        <div className="space-y-6">
            {returnTo && <BackToPoll to={returnTo} />}
            {isDesktop ? (
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <GameTimePanel mode="profile" rolling enabled={isAuthenticated} />
                </div>
            ) : (
                <div
                    data-testid="profile-game-time-phone"
                    className="h-[calc(100dvh-160px)] min-h-[980px] rounded-xl border border-edge-subtle bg-surface p-4"
                >
                    <PhoneWeekCheckStep variant="profile" hours={PROFILE_HOURS} />
                </div>
            )}
        </div>
    );
}
