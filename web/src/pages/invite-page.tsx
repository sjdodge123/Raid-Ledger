import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { resolveInviteCode, claimInviteCode } from '../lib/api-client';
import type { InviteCodeResolveResponseDto } from '@raid-ledger/contract';
import { LoadingSpinner } from '../components/ui/loading-spinner';
import { toast } from '../lib/toast';
import { API_BASE_URL } from '../lib/config';
import { formatRole } from '../lib/role-colors';
import { WowArmoryImportForm } from '../plugins/wow/components/wow-armory-import-form';

type RoleChoice = 'tank' | 'healer' | 'dps';

const DISCORD_ICON = (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
);

const CHECK_ICON = (
    <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
);

/** Step labels for the progress indicator */
const STEP_LABELS = ['Preview', 'Discord', 'Character', 'Join'];

function StepIndicator({ current, total }: { current: number; total: number }) {
    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            {Array.from({ length: total }, (_, i) => {
                const stepNum = i + 1;
                const isActive = stepNum === current;
                const isCompleted = stepNum < current;
                return (
                    <div key={i} className="flex items-center gap-2">
                        <div className="flex flex-col items-center">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                                    isActive
                                        ? 'bg-emerald-600 text-white'
                                        : isCompleted
                                          ? 'bg-emerald-600/30 text-emerald-400'
                                          : 'bg-panel text-muted border border-edge'
                                }`}
                            >
                                {isCompleted ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : (
                                    stepNum
                                )}
                            </div>
                            <span className={`text-[10px] mt-1 ${isActive ? 'text-foreground' : 'text-muted'}`}>
                                {STEP_LABELS[i]}
                            </span>
                        </div>
                        {i < total - 1 && (
                            <div
                                className={`w-8 h-px mb-4 ${
                                    isCompleted ? 'bg-emerald-600/50' : 'bg-edge'
                                }`}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * /i/:code route -- Guided PUG invite wizard (ROK-263, ROK-394).
 *
 * Steps:
 * 1. Event Preview — show event info, "Sign in with Discord" CTA
 * 2. Join Discord Server — Discord server invite link (skip if none)
 * 3. Load Character / Choose Role — WoW import or manual role picker
 * 4. Join Event — confirm claim, success screen
 * 5. (Backend) Discord DM with event link
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
    const [selectedRole, setSelectedRole] = useState<RoleChoice | null>(null);
    const [showManualRoleSelector, setShowManualRoleSelector] = useState(false);

    /** Wizard step (1-4) */
    const [step, setStep] = useState(1);
    /** Post-claim success state */
    const [claimResult, setClaimResult] = useState<{
        type: 'signup' | 'claimed';
        eventId: number;
        discordServerInviteUrl?: string;
    } | null>(null);

    const gameInfo = resolveData?.event?.game;
    const registryId = gameInfo?.registryId;
    const isBlizzardGame = gameInfo?.isBlizzardGame === true;
    const hasRoles = gameInfo?.hasRoles === true;

    // Fetch user's characters for this game
    const { data: charactersData, refetch: refetchCharacters } = useMyCharacters(
        registryId,
        isAuthenticated && !!registryId,
    );
    const hasCharacterForGame = (charactersData?.data?.length ?? 0) > 0;

    // Should show WoW import form in step 3?
    const shouldShowImportForm =
        isBlizzardGame && !hasCharacterForGame && !showManualRoleSelector;

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

    // Auto-advance step after OAuth return
    useEffect(() => {
        if (authLoading || processedRef.current) return;
        if (!isAuthenticated || !code) return;

        const params = new URLSearchParams(window.location.search);
        const isOAuthReturn = params.get('claim') === '1';
        const storedCode = sessionStorage.getItem('invite_code');

        if (isOAuthReturn || storedCode === code) {
            processedRef.current = true;
            sessionStorage.removeItem('invite_code');
            if (isOAuthReturn) {
                window.history.replaceState({}, '', window.location.pathname);
            }
            // Jump to step 2 (Discord) after OAuth
            setStep(2);
        }
    }, [authLoading, isAuthenticated, code]);

    // If already authenticated on mount (not OAuth return), start at step 2
    useEffect(() => {
        if (authLoading || processedRef.current) return;
        if (isAuthenticated && resolveData?.valid && step === 1) {
            setStep(2);
        }
    }, [authLoading, isAuthenticated, resolveData, step]);

    const handleClaim = useCallback(async (roleOverride?: RoleChoice) => {
        if (!code) return;
        setIsClaiming(true);
        try {
            const result = await claimInviteCode(code, roleOverride ?? selectedRole ?? undefined);
            setClaimResult(result);
            setStep(4);

            if (result.type === 'signup') {
                toast.success("You're signed up!", {
                    description: 'You have been added to the event roster.',
                });
            } else {
                toast.success('Invite accepted!', {
                    description: 'You have joined this event.',
                });
            }
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
    }, [code, navigate, resolveData, selectedRole]);

    /**
     * After a successful WoW character import, refetch characters and auto-claim
     * using the imported character's role.
     */
    const handleImportSuccess = useCallback(async () => {
        const result = await refetchCharacters();
        const chars = result.data?.data;
        if (chars && chars.length > 0) {
            const newest = [...chars].sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            )[0];
            const importedRole = (newest.roleOverride ?? newest.role) as RoleChoice | null;
            if (importedRole) {
                toast.success('Character imported! Joining event...', {
                    description: `${newest.name} (${formatRole(importedRole)})`,
                });
                void handleClaim(importedRole);
            } else {
                toast.success('Character imported!', {
                    description: 'Now select your role to join.',
                });
                setShowManualRoleSelector(true);
            }
        }
    }, [refetchCharacters, handleClaim]);

    const handleLogin = () => {
        if (code) {
            sessionStorage.setItem('invite_code', code);
        }
        window.location.href = `${API_BASE_URL}/auth/discord/invite?code=${encodeURIComponent(code ?? '')}`;
    };

    // -- Loading --
    if (isResolving || authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <LoadingSpinner />
                <p className="text-muted">Loading invite...</p>
            </div>
        );
    }

    // -- Error / Invalid --
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

    const { event } = resolveData;

    // Determine whether to skip step 2 (no Discord invite available)
    const hasDiscordInvite = !!resolveData.discordServerInviteUrl;
    // Determine whether step 3 needs a role (game has roles)
    const requiresRole = hasRoles && !shouldShowImportForm;

    // Compute effective total steps (skip Discord step if no invite)
    const effectiveStepCount = 4;

    // -- Event card header (shared across steps) --
    const eventHeader = (
        <div className="text-center mb-4">
            {event?.game?.coverUrl && (
                <img
                    src={event.game.coverUrl}
                    alt={event.game.name}
                    className="mx-auto mb-3 h-16 w-16 rounded-lg object-cover"
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />
            )}
            <p className="text-xs uppercase tracking-wide text-muted mb-1">
                You have been invited to
            </p>
            <h1 className="text-xl font-bold text-foreground mb-0.5">
                {event?.title ?? 'Event'}
            </h1>
            {event?.game && (
                <p className="text-sm text-muted mb-1">
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
        </div>
    );

    // =====================================================================
    // STEP 4: Success (post-claim)
    // =====================================================================
    if (step === 4 && claimResult) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
                <div className="w-full max-w-md">
                    <StepIndicator current={4} total={effectiveStepCount} />
                    <div className="rounded-xl border border-edge bg-surface p-6 text-center shadow-lg">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            {CHECK_ICON}
                        </div>
                        <h1 className="text-xl font-bold text-foreground mb-2">
                            You are in!
                        </h1>
                        <p className="text-sm text-muted mb-6">
                            {claimResult.discordServerInviteUrl
                                ? 'Join the Discord server to chat with the team and get event updates.'
                                : 'You have been added to the event roster.'}
                        </p>

                        <div className="space-y-3">
                            {claimResult.discordServerInviteUrl && (
                                <a
                                    href={claimResult.discordServerInviteUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                                >
                                    {DISCORD_ICON}
                                    Join Discord Server
                                </a>
                            )}
                            <button
                                onClick={() => navigate(`/events/${claimResult.eventId}`, { replace: true })}
                                className={`btn w-full ${claimResult.discordServerInviteUrl ? 'btn-secondary' : 'btn-primary'}`}
                            >
                                View Event Details
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // =====================================================================
    // STEP 1: Event Preview (unauthenticated)
    // =====================================================================
    if (step === 1) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
                <div className="w-full max-w-md">
                    <StepIndicator current={1} total={effectiveStepCount} />
                    <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
                        {eventHeader}

                        <div className="mt-6 space-y-3">
                            <button
                                onClick={handleLogin}
                                className="btn btn-primary w-full flex items-center justify-center gap-2"
                            >
                                {DISCORD_ICON}
                                Sign in with Discord to Join
                            </button>
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
            </div>
        );
    }

    // =====================================================================
    // STEP 2: Join Discord Server
    // =====================================================================
    if (step === 2) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
                <div className="w-full max-w-md">
                    <StepIndicator current={2} total={effectiveStepCount} />
                    <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
                        {eventHeader}

                        {hasDiscordInvite ? (
                            <div className="mt-4">
                                <p className="text-sm text-muted mb-4 text-center">
                                    Join the Discord server to chat with the team and hear voice comms during the event.
                                </p>
                                <a
                                    href={resolveData.discordServerInviteUrl!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary w-full flex items-center justify-center gap-2 mb-3"
                                >
                                    {DISCORD_ICON}
                                    Join Discord Server
                                </a>
                                <button
                                    onClick={() => setStep(3)}
                                    className="btn btn-secondary w-full"
                                >
                                    {hasRoles ? 'Next: Choose Your Role' : 'Next: Join Event'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStep(3)}
                                    className="mt-2 w-full text-xs text-muted hover:text-foreground transition-colors"
                                >
                                    Skip for now
                                </button>
                            </div>
                        ) : (
                            <div className="mt-4">
                                <p className="text-sm text-muted mb-4 text-center">
                                    You are signed in. Let's get you set up for this event.
                                </p>
                                <button
                                    onClick={() => setStep(3)}
                                    className="btn btn-primary w-full"
                                >
                                    {hasRoles ? 'Next: Choose Your Role' : 'Next: Join Event'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // =====================================================================
    // STEP 3: Load Character / Choose Role
    // =====================================================================
    if (step === 3) {
        // For games without roles, auto-claim immediately
        if (!hasRoles) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
                    <div className="w-full max-w-md">
                        <StepIndicator current={3} total={effectiveStepCount} />
                        <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
                            {eventHeader}

                            <div className="mt-4">
                                <p className="text-sm text-muted mb-4 text-center">
                                    Ready to join this event?
                                </p>
                                <button
                                    onClick={() => void handleClaim()}
                                    disabled={isClaiming}
                                    className="btn btn-primary w-full"
                                >
                                    {isClaiming ? 'Joining...' : 'Join Event'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
                <div className="w-full max-w-md">
                    <StepIndicator current={3} total={effectiveStepCount} />
                    <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
                        {eventHeader}

                        {/* WoW character import */}
                        {shouldShowImportForm && (
                            <div className="mt-4 text-left">
                                <p className="text-sm text-muted mb-3 text-center">
                                    Import your character to auto-detect your role
                                </p>
                                <WowArmoryImportForm
                                    gameVariant={gameInfo?.gameVariant ?? undefined}
                                    defaultRealm={gameInfo?.inviterRealm ?? undefined}
                                    onSuccess={() => void handleImportSuccess()}
                                    isMain
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowManualRoleSelector(true)}
                                    className="mt-3 w-full text-xs text-muted hover:text-foreground transition-colors"
                                >
                                    Skip, choose role manually
                                </button>
                            </div>
                        )}

                        {/* Manual role selection */}
                        {!shouldShowImportForm && (
                            <div className="mt-4">
                                <p className="text-sm text-muted mb-3 text-center">
                                    Select your role for this event
                                </p>
                                <div className="flex justify-center gap-2 mb-4">
                                    {(['tank', 'healer', 'dps'] as const).map((role) => (
                                        <button
                                            key={role}
                                            type="button"
                                            onClick={() => setSelectedRole(role)}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                                                selectedRole === role
                                                    ? 'bg-emerald-600 text-white border-emerald-500'
                                                    : 'bg-panel text-muted border-edge hover:border-foreground/30'
                                            }`}
                                        >
                                            {formatRole(role)}
                                        </button>
                                    ))}
                                </div>

                                <button
                                    onClick={() => void handleClaim()}
                                    disabled={isClaiming || (requiresRole && !selectedRole)}
                                    className="btn btn-primary w-full"
                                >
                                    {isClaiming ? 'Joining...' : 'Join Event'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Fallback — should not reach here
    return null;
}
