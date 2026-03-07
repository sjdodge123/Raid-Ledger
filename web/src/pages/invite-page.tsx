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

/**
 * /i/:code route -- Guided PUG invite wizard (ROK-263, ROK-394, ROK-409).
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
    const [selectedRole, setSelectedRole] = useState<PugRole | null>(null);
    const [showManualRoleSelector, setShowManualRoleSelector] = useState(false);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [showImportForm, setShowImportForm] = useState(false);
    const [step, setStep] = useState(1);
    const [discordJoinClicked, setDiscordJoinClicked] = useState(false);
    const [claimResult, setClaimResult] = useState<{
        type: 'signup' | 'claimed';
        eventId: number;
        discordServerInviteUrl?: string;
    } | null>(null);

    const gameInfo = resolveData?.event?.game;
    const gameId = gameInfo?.gameId;
    const isBlizzardGame = gameInfo?.isBlizzardGame === true;
    const hasRoles = gameInfo?.hasRoles === true;
    const communityName = resolveData?.communityName;
    const discordJoinLabel = communityName ? `Join ${communityName}'s Discord` : 'Join Discord Server';

    const { data: charactersData, refetch: refetchCharacters } = useMyCharacters(gameId, isAuthenticated && !!gameId);
    const characters = charactersData?.data ?? [];
    const hasCharacterForGame = characters.length > 0;

    const shouldShowCharacterSelector = isBlizzardGame && hasCharacterForGame && !showImportForm && !showManualRoleSelector;
    const shouldShowImportForm = (isBlizzardGame && !hasCharacterForGame && !showManualRoleSelector) || showImportForm;

    const selectedCharacter = selectedCharacterId ? characters.find((c) => c.id === selectedCharacterId) ?? null : null;
    const characterRole = selectedCharacter
        ? (selectedCharacter.effectiveRole ?? selectedCharacter.roleOverride ?? selectedCharacter.role) as PugRole | null
        : null;

    useEffect(() => {
        if (!code) return;
        setIsResolving(true);
        resolveInviteCode(code)
            .then((data) => { setResolveData(data); if (!data.valid) setError('This invite link is invalid or has expired.'); })
            .catch(() => setError('This invite link is invalid or has expired.'))
            .finally(() => setIsResolving(false));
    }, [code]);

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
    }, [authLoading, isAuthenticated, code]);

    useEffect(() => {
        if (authLoading || processedRef.current) return;
        if (isAuthenticated && resolveData?.valid && step === 1) setStep(2);
    }, [authLoading, isAuthenticated, resolveData, step]);

    const handleClaim = useCallback(async (roleOverride?: PugRole, characterIdOverride?: string) => {
        if (!code) return;
        setIsClaiming(true);
        try {
            const effectiveCharacterId = characterIdOverride ?? selectedCharacterId ?? undefined;
            const result = await claimInviteCode(code, roleOverride ?? selectedRole ?? undefined, effectiveCharacterId);
            setClaimResult(result);
            setStep(3);
            toast.success(result.type === 'signup' ? "You're signed up!" : 'Invite accepted!', {
                description: result.type === 'signup' ? 'You have been added to the event roster.' : 'You have joined this event.',
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Please try again.';
            if (message.includes('already signed up') || message.includes('already')) {
                toast.info('Already signed up', { description: message });
                if (resolveData?.event) navigate(`/events/${resolveData.event.id}`, { replace: true });
            } else {
                setError(message);
            }
        } finally {
            setIsClaiming(false);
        }
    }, [code, navigate, resolveData, selectedRole, selectedCharacterId]);

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

    const handleLogin = (): void => {
        if (code) sessionStorage.setItem('invite_code', code);
        window.location.href = `${API_BASE_URL}/auth/discord/invite?code=${encodeURIComponent(code ?? '')}`;
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
                <h1 className="text-xl font-semibold text-foreground">Invalid Invite</h1>
                <p className="text-muted">{error ?? 'This invite link is invalid or has expired.'}</p>
                <button onClick={() => navigate('/calendar')} className="btn btn-secondary">Go to Calendar</button>
            </div>
        );
    }

    const { event } = resolveData;
    const hasDiscordInvite = !!resolveData.discordServerInviteUrl;
    const totalSteps = hasDiscordInvite ? 4 : 3;
    const stepLabels = hasDiscordInvite ? STEP_LABELS : STEP_LABELS.slice(0, 3);
    const eventHeader = <EventHeader event={event} />;

    if (step === 3 && claimResult) {
        const discordInviteUrl = claimResult.discordServerInviteUrl ?? resolveData.discordServerInviteUrl;
        return (
            <SuccessStep
                stepLabels={stepLabels}
                totalSteps={totalSteps}
                event={event}
                discordInviteUrl={discordInviteUrl}
                discordJoinLabel={discordJoinLabel}
                discordJoinClicked={discordJoinClicked}
                onDiscordJoinClick={() => setDiscordJoinClicked(true)}
                onContinue={() => navigate('/onboarding', { replace: true })}
            />
        );
    }

    if (step === 1) {
        return (
            <AuthStep
                stepLabels={stepLabels}
                totalSteps={totalSteps}
                eventHeader={eventHeader}
                event={event}
                onLogin={handleLogin}
                onViewEvent={() => event && navigate(`/events/${event.id}`)}
            />
        );
    }

    if (step === 2) {
        return (
            <CharacterStep
                stepLabels={stepLabels}
                totalSteps={totalSteps}
                eventHeader={eventHeader}
                hasRoles={hasRoles}
                shouldShowCharacterSelector={shouldShowCharacterSelector}
                shouldShowImportForm={shouldShowImportForm}
                characters={characters}
                selectedCharacterId={selectedCharacterId}
                selectedRole={selectedRole}
                characterRole={characterRole}
                isClaiming={isClaiming}
                gameInfo={gameInfo ? { gameVariant: gameInfo.gameVariant ?? undefined, inviterRealm: gameInfo.inviterRealm ?? undefined } : undefined}
                onSelectCharacter={(charId, role) => { setSelectedCharacterId(charId); if (role) setSelectedRole(role); }}
                onSelectRole={setSelectedRole}
                onClaim={(role, charId) => void handleClaim(role, charId)}
                onShowImportForm={() => setShowImportForm(true)}
                onShowManualRoleSelector={() => { setShowManualRoleSelector(true); setShowImportForm(false); }}
                onImportSuccess={() => void handleImportSuccess()}
            />
        );
    }

    return null;
}
