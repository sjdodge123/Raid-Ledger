import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { resolveInviteCode, claimInviteCode } from '../lib/api-client';
import type { InviteCodeResolveResponseDto } from '@raid-ledger/contract';
import { LoadingSpinner } from '../components/ui/loading-spinner';
import { toast } from '../lib/toast';
import { API_BASE_URL } from '../lib/config';
import { formatRole } from '../lib/role-colors';

/**
 * /i/:code route -- Magic invite link landing page (ROK-263).
 *
 * Flow:
 * 1. Resolve the invite code (public endpoint) to show event info
 * 2. If user is authenticated, offer a "Join Event" button
 * 3. If not authenticated, redirect to Discord OAuth (store code in session)
 * 4. On claim: smart matching decides signup vs PUG slot claim
 * 5. Redirect to event detail page
 */
export function InvitePage() {
    const { code } = useParams<{ code: string }>();
    const navigate = useNavigate();
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const processedRef = useRef(false);

    const [resolveData, setResolveData] = useState<InviteCodeResolveResponseDto | null>(null);
    const [isResolving, setIsResolving] = useState(true);
    const [isClaiming, setIsClaiming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Resolve the invite code on mount
    useEffect(() => {
        if (!code) return;
        setIsResolving(true);
        resolveInviteCode(code)
            .then((data) => {
                setResolveData(data);
                if (!data.valid) {
                    setError('This invite link is invalid or has expired.');
                }
            })
            .catch(() => {
                setError('This invite link is invalid or has expired.');
            })
            .finally(() => setIsResolving(false));
    }, [code]);

    const handleClaim = useCallback(async () => {
        if (!code) return;
        setIsClaiming(true);
        try {
            const result = await claimInviteCode(code);
            if (result.type === 'signup') {
                toast.success("You're signed up!", {
                    description: 'Your account was recognized and you have been added as a member.',
                });
            } else {
                toast.success('Invite accepted!', {
                    description: 'You have joined this event.',
                });
            }
            navigate(`/events/${result.eventId}`, { replace: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Please try again.';
            if (message.includes('already signed up') || message.includes('already')) {
                toast.info('Already signed up', { description: message });
                if (resolveData?.event) {
                    navigate(`/events/${resolveData.event.id}`, { replace: true });
                }
            } else {
                setError(message);
            }
        } finally {
            setIsClaiming(false);
        }
    }, [code, navigate, resolveData]);

    // Auto-claim if user is authenticated and returning from OAuth
    useEffect(() => {
        if (authLoading || processedRef.current) return;
        if (!isAuthenticated || !code) return;

        const storedCode = sessionStorage.getItem('invite_code');
        if (storedCode === code) {
            processedRef.current = true;
            sessionStorage.removeItem('invite_code');
            void handleClaim();
        }
    }, [authLoading, isAuthenticated, code, handleClaim]);

    const handleLogin = () => {
        if (code) {
            sessionStorage.setItem('invite_code', code);
        }
        window.location.href = `${API_BASE_URL}/auth/discord`;
    };

    if (isResolving || authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <LoadingSpinner />
                <p className="text-muted">Loading invite...</p>
            </div>
        );
    }

    if (error || !resolveData?.valid) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <h1 className="text-xl font-semibold text-foreground">
                    Invalid Invite
                </h1>
                <p className="text-muted">
                    {error ?? 'This invite link is invalid or has expired.'}
                </p>
                <button
                    onClick={() => navigate('/calendar')}
                    className="btn btn-secondary"
                >
                    Go to Calendar
                </button>
            </div>
        );
    }

    const { event, slot } = resolveData;

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            {/* Event card */}
            <div className="w-full max-w-md rounded-xl border border-edge bg-surface p-6 text-center shadow-lg">
                {event?.game?.coverUrl && (
                    <img
                        src={event.game.coverUrl}
                        alt={event.game.name}
                        className="mx-auto mb-4 h-20 w-20 rounded-lg object-cover"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                )}
                <p className="text-xs uppercase tracking-wide text-muted mb-1">
                    You have been invited to
                </p>
                <h1 className="text-xl font-bold text-foreground mb-1">
                    {event?.title ?? 'Event'}
                </h1>
                {event?.game && (
                    <p className="text-sm text-muted mb-2">
                        {event.game.name}
                    </p>
                )}
                {event?.startTime && (
                    <p className="text-sm text-muted">
                        {new Date(event.startTime).toLocaleDateString(undefined, {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                        })}{' '}
                        at{' '}
                        {new Date(event.startTime).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                        })}
                    </p>
                )}
                {slot && (
                    <p className="mt-2 text-sm text-secondary">
                        Slot: {formatRole(slot.role)}
                    </p>
                )}

                {/* Action buttons */}
                <div className="mt-6 space-y-3">
                    {isAuthenticated ? (
                        <button
                            onClick={() => void handleClaim()}
                            disabled={isClaiming}
                            className="btn btn-primary w-full"
                        >
                            {isClaiming ? 'Joining...' : 'Join Event'}
                        </button>
                    ) : (
                        <button
                            onClick={handleLogin}
                            className="btn btn-primary w-full flex items-center justify-center gap-2"
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                            </svg>
                            Sign in with Discord to Join
                        </button>
                    )}

                    {event && (
                        <button
                            onClick={() => navigate(`/events/${event.id}`)}
                            className="btn btn-secondary w-full"
                        >
                            View Event Details
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
