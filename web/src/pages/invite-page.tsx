import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { resolveInviteCode, claimInviteCode } from '../lib/api-client';
import type { InviteCodeResolveResponseDto, PugRole } from '@raid-ledger/contract';
import { LoadingSpinner } from '../components/ui/loading-spinner';
import { toast } from '../lib/toast';
import { API_BASE_URL } from '../lib/config';
import { formatRole } from '../lib/role-colors';
import { STEP_LABELS } from './invite/invite-labels';
import { EventHeader, AuthStep, SuccessStep, CharacterStep } from './invite/invite-steps';

function useInviteClaim(opts: {
    code: string | undefined; navigate: ReturnType<typeof useNavigate>;
    resolveData: InviteCodeResolveResponseDto | null; setStep: (s: number) => void;
}) {
    const { code, navigate, resolveData, setStep } = opts;
    const [isClaiming, setIsClaiming] = useState(false);
    const [selectedRole, setSelectedRole] = useState<PugRole | null>(null);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [claimResult, setClaimResult] = useState<{ type: 'signup' | 'claimed'; eventId: number; discordServerInviteUrl?: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleClaim = useCallback(async (roleOverride?: PugRole, characterIdOverride?: string) => {
        if (!code) return;
        setIsClaiming(true);
        try {
            const effectiveCharacterId = characterIdOverride ?? selectedCharacterId ?? undefined;
            const result = await claimInviteCode(code, roleOverride ?? selectedRole ?? undefined, effectiveCharacterId);
            setClaimResult(result);
            setStep(3);
            showClaimToast(result.type);
        } catch (err) {
            handleClaimError(err, resolveData, navigate, setError);
        } finally {
            setIsClaiming(false);
        }
    }, [code, navigate, resolveData, selectedRole, selectedCharacterId, setStep]);

    return { isClaiming, selectedRole, setSelectedRole, selectedCharacterId, setSelectedCharacterId, claimResult, handleClaim, claimError: error };
}

function showClaimToast(type: 'signup' | 'claimed'): void {
    toast.success(type === 'signup' ? "You're signed up!" : 'Invite accepted!', {
        description: type === 'signup' ? 'You have been added to the event roster.' : 'You have joined this event.',
    });
}

function handleClaimError(err: unknown, resolveData: InviteCodeResolveResponseDto | null, navigate: ReturnType<typeof useNavigate>, setError: (e: string) => void): void {
    const message = err instanceof Error ? err.message : 'Please try again.';
    if (message.includes('already signed up') || message.includes('already')) {
        toast.info('Already signed up', { description: message });
        if (resolveData?.event) navigate(`/events/${resolveData.event.id}`, { replace: true });
    } else {
        setError(message);
    }
}

function useImportHandler(refetchCharacters: () => Promise<{ data?: { data?: { id: string; name: string; roleOverride: string | null; role: string | null; createdAt: string }[] } }>, handleClaim: (role?: PugRole, charId?: string) => Promise<void>) {
    const [showManualRoleSelector, setShowManualRoleSelector] = useState(false);
    const [showImportForm, setShowImportForm] = useState(false);

    const handleImportSuccess = useCallback(async () => {
        const result = await refetchCharacters();
        const chars = result.data?.data;
        if (chars && chars.length > 0) {
            const newest = [...chars].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            const importedRole = (newest.roleOverride ?? newest.role) as PugRole | null;
            if (importedRole) {
                toast.success('Character imported! Joining event...', { description: `${newest.name} (${formatRole(importedRole)})` });
                void handleClaim(importedRole, newest.id);
            } else {
                toast.success('Character imported!', { description: 'Now select your role to join.' });
                setShowManualRoleSelector(true);
                setShowImportForm(false);
            }
        }
    }, [refetchCharacters, handleClaim]);

    return { showManualRoleSelector, setShowManualRoleSelector, showImportForm, setShowImportForm, handleImportSuccess };
}

/**
 * /i/:code route -- Guided PUG invite wizard (ROK-263, ROK-394, ROK-409).
 */
function useInviteEffects(code: string | undefined, authLoading: boolean, isAuthenticated: boolean) {
    const processedRef = useRef(false);
    const [resolveData, setResolveData] = useState<InviteCodeResolveResponseDto | null>(null);
    const [isResolving, setIsResolving] = useState(true);
    const [resolveError, setResolveError] = useState<string | null>(null);
    const [step, setStep] = useState(1);

    useResolveEffect(code, setResolveData, setResolveError, setIsResolving);
    useOAuthReturnEffect(authLoading, isAuthenticated, code, processedRef, setStep);
    useAutoAdvanceEffect(authLoading, isAuthenticated, resolveData, step, processedRef, setStep);

    return { resolveData, isResolving, resolveError, step, setStep };
}

function useResolveEffect(code: string | undefined, setResolveData: (d: InviteCodeResolveResponseDto) => void, setError: (e: string) => void, setIsResolving: (v: boolean) => void) {
    useEffect(() => {
        if (!code) return;
        setIsResolving(true);
        resolveInviteCode(code)
            .then((data) => { setResolveData(data); if (!data.valid) setError('This invite link is invalid or has expired.'); })
            .catch(() => setError('This invite link is invalid or has expired.'))
            .finally(() => setIsResolving(false));
    }, [code, setResolveData, setError, setIsResolving]);
}

function useOAuthReturnEffect(authLoading: boolean, isAuthenticated: boolean, code: string | undefined, processedRef: React.MutableRefObject<boolean>, setStep: (s: number) => void) {
    useEffect(() => {
        if (authLoading || processedRef.current) return;
        if (!isAuthenticated || !code) return;
        const params = new URLSearchParams(window.location.search);
        const isOAuthReturn = params.get('claim') === '1';
        const storedCode = sessionStorage.getItem('invite_code');
        if (isOAuthReturn || storedCode === code) {
            processedRef.current = true;
            sessionStorage.removeItem('invite_code');
            if (isOAuthReturn) window.history.replaceState({}, '', window.location.pathname);
            setStep(2);
        }
    }, [authLoading, isAuthenticated, code, processedRef, setStep]);
}

function useAutoAdvanceEffect(authLoading: boolean, isAuthenticated: boolean, resolveData: InviteCodeResolveResponseDto | null, step: number, processedRef: React.MutableRefObject<boolean>, setStep: (s: number) => void) {
    useEffect(() => {
        if (authLoading || processedRef.current) return;
        if (isAuthenticated && resolveData?.valid && step === 1) setStep(2);
    }, [authLoading, isAuthenticated, resolveData, step, processedRef, setStep]);
}

export function InvitePage() {
    const { code } = useParams<{ code: string }>();
    const navigate = useNavigate();
    const { isAuthenticated, isLoading: authLoading } = useAuth();

    const { resolveData, isResolving, resolveError, step, setStep } = useInviteEffects(code, authLoading, isAuthenticated);
    const claim = useInviteClaim({ code, navigate, resolveData, setStep });
    const gameInfo = resolveData?.event?.game;
    const { data: charactersData, refetch: refetchCharacters } = useMyCharacters(gameInfo?.gameId, isAuthenticated && !!gameInfo?.gameId);
    const characters = charactersData?.data ?? [];
    const imp = useImportHandler(refetchCharacters, claim.handleClaim);
    const error = resolveError ?? claim.claimError;

    if (isResolving || authLoading) return <InviteLoading />;
    if (error || !resolveData?.valid) return <InviteInvalid error={error} onNavigate={() => navigate('/calendar')} />;

    return (
        <InviteStepRouter step={step} resolveData={resolveData} claim={claim} imp={imp}
            characters={characters} gameInfo={gameInfo} navigate={navigate} code={code} />
    );
}

function InviteLoading(): JSX.Element {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <LoadingSpinner />
            <p className="text-muted">Loading invite...</p>
        </div>
    );
}

function InviteInvalid({ error, onNavigate }: { error: string | null; onNavigate: () => void }): JSX.Element {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <h1 className="text-xl font-semibold text-foreground">Invalid Invite</h1>
            <p className="text-muted">{error ?? 'This invite link is invalid or has expired.'}</p>
            <button onClick={onNavigate} className="btn btn-secondary">Go to Calendar</button>
        </div>
    );
}

function InviteStepRouter({ step, resolveData, claim, imp, characters, gameInfo, navigate, code }: {
    step: number; resolveData: InviteCodeResolveResponseDto;
    claim: ReturnType<typeof useInviteClaim>; imp: ReturnType<typeof useImportHandler>;
    characters: { id: string; name: string; effectiveRole?: string | null; roleOverride: string | null; role: string | null; createdAt: string }[];
    gameInfo: InviteCodeResolveResponseDto['event'] extends { game?: infer G } ? G : undefined;
    navigate: ReturnType<typeof useNavigate>; code: string | undefined;
}): JSX.Element | null {
    const { event } = resolveData;
    const hasDiscordInvite = !!resolveData.discordServerInviteUrl;
    const totalSteps = hasDiscordInvite ? 4 : 3;
    const stepLabels = hasDiscordInvite ? STEP_LABELS : STEP_LABELS.slice(0, 3);
    const communityName = resolveData.communityName;
    const discordJoinLabel = communityName ? `Join ${communityName}'s Discord` : 'Join Discord Server';

    if (step === 3 && claim.claimResult) {
        return <InviteSuccessView claim={claim} resolveData={resolveData} stepLabels={stepLabels}
            totalSteps={totalSteps} discordJoinLabel={discordJoinLabel} navigate={navigate} />;
    }
    if (step === 1) {
        return <InviteAuthView event={event} stepLabels={stepLabels} totalSteps={totalSteps} navigate={navigate} code={code} />;
    }
    if (step === 2) {
        return <InviteCharacterView event={event} stepLabels={stepLabels} totalSteps={totalSteps}
            claim={claim} imp={imp} characters={characters} gameInfo={gameInfo} />;
    }
    return null;
}

function InviteSuccessView({ claim, resolveData, stepLabels, totalSteps, discordJoinLabel, navigate }: {
    claim: ReturnType<typeof useInviteClaim>; resolveData: InviteCodeResolveResponseDto;
    stepLabels: typeof STEP_LABELS; totalSteps: number; discordJoinLabel: string; navigate: ReturnType<typeof useNavigate>;
}): JSX.Element {
    const [discordJoinClicked, setDiscordJoinClicked] = useState(false);
    const discordInviteUrl = claim.claimResult?.discordServerInviteUrl ?? resolveData.discordServerInviteUrl;
    return (
        <SuccessStep stepLabels={stepLabels} totalSteps={totalSteps} event={resolveData.event}
            discordInviteUrl={discordInviteUrl} discordJoinLabel={discordJoinLabel}
            discordJoinClicked={discordJoinClicked} onDiscordJoinClick={() => setDiscordJoinClicked(true)}
            onContinue={() => navigate('/onboarding', { replace: true })} />
    );
}

function InviteAuthView({ event, stepLabels, totalSteps, navigate, code }: {
    event: InviteCodeResolveResponseDto['event']; stepLabels: typeof STEP_LABELS; totalSteps: number;
    navigate: ReturnType<typeof useNavigate>; code: string | undefined;
}): JSX.Element {
    const handleLogin = (): void => {
        if (code) sessionStorage.setItem('invite_code', code);
        window.location.href = `${API_BASE_URL}/auth/discord/invite?code=${encodeURIComponent(code ?? '')}`;
    };
    return (
        <AuthStep stepLabels={stepLabels} totalSteps={totalSteps} eventHeader={<EventHeader event={event} />}
            event={event} onLogin={handleLogin} onViewEvent={() => event && navigate(`/events/${event.id}`)} />
    );
}

function InviteCharacterView({ event, stepLabels, totalSteps, claim, imp, characters, gameInfo }: {
    event: InviteCodeResolveResponseDto['event']; stepLabels: typeof STEP_LABELS; totalSteps: number;
    claim: ReturnType<typeof useInviteClaim>; imp: ReturnType<typeof useImportHandler>;
    characters: { id: string; name: string; effectiveRole?: string | null; roleOverride: string | null; role: string | null; createdAt: string }[];
    gameInfo: InviteCodeResolveResponseDto['event'] extends { game?: infer G } ? G : undefined;
}): JSX.Element {
    const isBlizzardGame = gameInfo?.isBlizzardGame === true;
    const hasRoles = gameInfo?.hasRoles === true;
    const hasCharacterForGame = characters.length > 0;
    const shouldShowCharacterSelector = isBlizzardGame && hasCharacterForGame && !imp.showImportForm && !imp.showManualRoleSelector;
    const shouldShowImportForm = (isBlizzardGame && !hasCharacterForGame && !imp.showManualRoleSelector) || imp.showImportForm;
    const selectedCharacter = claim.selectedCharacterId ? characters.find((c) => c.id === claim.selectedCharacterId) ?? null : null;
    const characterRole = selectedCharacter
        ? (selectedCharacter.effectiveRole ?? selectedCharacter.roleOverride ?? selectedCharacter.role) as PugRole | null
        : null;

    return (
        <CharacterStep stepLabels={stepLabels} totalSteps={totalSteps} eventHeader={<EventHeader event={event} />}
            hasRoles={hasRoles} shouldShowCharacterSelector={shouldShowCharacterSelector}
            shouldShowImportForm={shouldShowImportForm} characters={characters}
            selectedCharacterId={claim.selectedCharacterId} selectedRole={claim.selectedRole}
            characterRole={characterRole} isClaiming={claim.isClaiming}
            gameInfo={gameInfo ? { gameVariant: gameInfo.gameVariant ?? undefined, inviterRealm: gameInfo.inviterRealm ?? undefined } : undefined}
            onSelectCharacter={(charId, role) => { claim.setSelectedCharacterId(charId); if (role) claim.setSelectedRole(role); }}
            onSelectRole={claim.setSelectedRole}
            onClaim={(role, charId) => void claim.handleClaim(role, charId)}
            onShowImportForm={() => imp.setShowImportForm(true)}
            onShowManualRoleSelector={() => { imp.setShowManualRoleSelector(true); imp.setShowImportForm(false); }}
            onImportSuccess={() => void imp.handleImportSuccess()} />
    );
}
