/**
 * The profile's game time editor — one shape per viewport (ROK-1569).
 *
 * Below 768px the seven-column grid is unusable, so the phone gets the SAME
 * editor the poll's game-time check uses (`PhoneWeekCheckStep`, Option A comp):
 * one day on screen, paged or swiped, with only the sticky "Save my week"
 * footer — no prompt, no "Same as last week", no Skip, because nobody asked the
 * viewer a question here. Desktop keeps `GameTimePanel` untouched.
 *
 * The editor is `h-full`, so the phone branch supplies the bounded height the
 * sheet gives it elsewhere.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { GameTimePanel } from '../../components/features/game-time';
import { PhoneWeekCheckStep } from '../../components/features/game-time/phone/PhoneWeekCheckStep';
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
                    className="h-[70dvh] min-h-[380px] rounded-xl border border-edge-subtle bg-surface p-4"
                >
                    <PhoneWeekCheckStep variant="profile" />
                </div>
            )}
        </div>
    );
}
