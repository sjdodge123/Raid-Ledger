import type { JSX } from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, isAdmin } from '../hooks/use-auth';
import { useCompleteOnboardingFte } from '../hooks/use-onboarding-fte';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useUserHeartedGames } from '../hooks/use-user-profile';
import { useSystemStatus } from '../hooks/use-system-status';
import { toast } from '../lib/toast';
import { isDiscordLinked } from '../lib/avatar';
import { ConnectStep } from '../components/onboarding/connect-step';
import { DiscordJoinStep } from '../components/onboarding/discord-join-step';
import { GamesStep } from '../components/onboarding/games-step';
import { CharacterStep } from '../components/onboarding/character-step';
import { GameTimeStep } from '../components/onboarding/gametime-step';
import { AvatarThemeStep } from '../components/onboarding/avatar-theme-step';
import { useGuildMembership } from '../hooks/use-discord-onboarding';
import type { GameRegistryDto } from '@raid-ledger/contract';
import type { StepDef } from './onboarding-wizard/onboarding-types';
import { OnboardingBreadcrumbs } from './onboarding-wizard/OnboardingBreadcrumbs';

/**
 * FTE Onboarding Wizard Page (ROK-219 redesign).
 * Step flow: Connect (conditional) -> Games -> Character x N -> Game Time -> Personalize
 * Centered modal overlay. All steps are skippable. Escape dismisses.
 * Re-runnable from settings via /onboarding?rerun=1.
 */
export function OnboardingWizardPage(): JSX.Element | null {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const completeOnboarding = useCompleteOnboardingFte();
    const { games: registryGames } = useGameRegistry();
    const { data: heartedGamesData } = useUserHeartedGames(user?.id);
    const { data: systemStatus } = useSystemStatus();

    const [currentStep, setCurrentStep] = useState(0);
    const [extraCharCounts, setExtraCharCounts] = useState<Record<string, number>>({});

    const isRerun = searchParams.get('rerun') === '1';
    const discordConfigured = systemStatus?.discordConfigured ?? false;

    const needsConnect = useMemo(() => {
        if (!user || !discordConfigured) return false;
        return !isDiscordLinked(user.discordId);
    }, [user, discordConfigured]);

    const { data: guildMembership } = useGuildMembership(
        discordConfigured && !!user && isDiscordLinked(user.discordId),
    );

    const needsDiscordJoin = useMemo(() => {
        if (!discordConfigured || !user || !isDiscordLinked(user.discordId)) return false;
        if (!guildMembership) return true;
        return !guildMembership.isMember;
    }, [discordConfigured, user, guildMembership]);

    const qualifyingGames = useMemo(() => {
        const hearted = heartedGamesData?.data ?? [];
        if (hearted.length === 0 || registryGames.length === 0) return [];
        const registryByName = new Map(registryGames.map((g) => [g.name.toLowerCase(), g]));
        return hearted
            .map((h) => registryByName.get(h.name.toLowerCase()))
            .filter((g): g is GameRegistryDto => !!g && g.hasRoles);
    }, [heartedGamesData, registryGames]);

    const steps: StepDef[] = useMemo(() => {
        const s: StepDef[] = [];
        if (needsConnect) s.push({ key: 'connect', label: 'Connect' });
        s.push({ key: 'games', label: 'Games' });
        qualifyingGames.forEach((game) => {
            const total = 1 + (extraCharCounts[game.id] ?? 0);
            for (let j = 0; j < total; j++) {
                const displayName = game.shortName || game.name;
                s.push({
                    key: `character-${game.id}-${j}`,
                    label: total > 1 ? `${displayName} (${j + 1})` : displayName,
                    registryGame: game, charIndex: j,
                });
            }
        });
        s.push({ key: 'gametime', label: 'Game Time' });
        s.push({ key: 'avatar', label: 'Personalize' });
        if (needsDiscordJoin) s.push({ key: 'discord-join', label: 'Discord' });
        return s;
    }, [needsConnect, needsDiscordJoin, qualifyingGames, extraCharCounts]);

    const maxStep = steps.length - 1;
    const currentStepDef = steps[currentStep];
    const stepValidatorRef = useRef<(() => boolean) | null>(null);

    const goNext = useCallback(() => {
        if (stepValidatorRef.current && !stepValidatorRef.current()) return;
        stepValidatorRef.current = null;
        setCurrentStep((prev) => Math.min(prev + 1, maxStep));
    }, [maxStep]);

    const goBack = useCallback(() => {
        setCurrentStep((prev) => Math.max(prev - 1, 0));
    }, []);

    const addCharacterStep = useCallback((gameId: number) => {
        setExtraCharCounts((prev) => ({ ...prev, [gameId]: (prev[gameId] ?? 0) + 1 }));
        setCurrentStep((prev) => prev + 1);
    }, []);

    const removeCharacterStep = useCallback((gameId: number) => {
        setExtraCharCounts((prev) => {
            const current = prev[gameId] ?? 0;
            if (current <= 0) return prev;
            return { ...prev, [gameId]: current - 1 };
        });
        setCurrentStep((prev) => Math.max(prev - 1, 0));
    }, []);

    const getPostOnboardingRedirect = useCallback(() => {
        const pendingInvite = sessionStorage.getItem('invite_code');
        if (pendingInvite) {
            sessionStorage.removeItem('invite_code');
            return `/i/${pendingInvite}?claim=1`;
        }
        return '/calendar';
    }, []);

    const handleSkipAll = useCallback(() => {
        completeOnboarding.mutate(undefined, {
            onSuccess: () => {
                toast.info('Setup skipped. You can update your profile anytime.');
                navigate(getPostOnboardingRedirect(), { replace: true });
            },
        });
    }, [completeOnboarding, navigate, getPostOnboardingRedirect]);

    const handleComplete = useCallback(() => {
        completeOnboarding.mutate(undefined, {
            onSuccess: () => { navigate(getPostOnboardingRedirect(), { replace: true }); },
        });
    }, [completeOnboarding, navigate, getPostOnboardingRedirect]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleSkipAll(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSkipAll]);

    if (user && isAdmin(user) && !isRerun) return <Navigate to="/calendar" replace />;
    if (user?.onboardingCompletedAt && !isRerun) return <Navigate to="/calendar" replace />;

    const isFirstStep = currentStep === 0;
    const isFinalStep = currentStep === maxStep;
    const isCharacterStep = currentStepDef?.key.startsWith('character-');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-2xl mx-4 h-[90vh] flex flex-col bg-surface border border-edge/50 rounded-2xl shadow-2xl" role="dialog" aria-label="Onboarding wizard">
                <WizardHeader currentStep={currentStep} totalSteps={steps.length} isFinalStep={isFinalStep} onSkipAll={handleSkipAll} />
                <OnboardingBreadcrumbs steps={steps} currentStep={currentStep} setCurrentStep={setCurrentStep} removeCharacterStep={removeCharacterStep} user={user ?? null} />
                <WizardContent currentStepDef={currentStepDef} isCharacterStep={isCharacterStep} stepValidatorRef={stepValidatorRef} addCharacterStep={addCharacterStep} removeCharacterStep={removeCharacterStep} />
                <WizardFooter isFirstStep={isFirstStep} isFinalStep={isFinalStep} goBack={goBack} goNext={goNext} handleComplete={handleComplete} isPending={completeOnboarding.isPending} />
            </div>
        </div>
    );
}

/** Header with step counter and Skip All button */
function WizardHeader({ currentStep, totalSteps, isFinalStep, onSkipAll }: {
    currentStep: number; totalSteps: number; isFinalStep: boolean; onSkipAll: () => void;
}): JSX.Element {
    return (
        <div className="flex-shrink-0 border-b border-edge/30 px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <div className="text-sm text-muted">Step {currentStep + 1} of {totalSteps}</div>
            {!isFinalStep && (
                <button onClick={onSkipAll} className="text-sm text-muted hover:text-foreground transition-colors px-4 py-2.5 min-h-[44px] rounded-full hover:bg-edge/20">
                    Skip All
                </button>
            )}
        </div>
    );
}

/** Scrollable step content area */
function WizardContent({ currentStepDef, isCharacterStep, stepValidatorRef, addCharacterStep, removeCharacterStep }: {
    currentStepDef: StepDef | undefined;
    isCharacterStep: boolean;
    stepValidatorRef: React.MutableRefObject<(() => boolean) | null>;
    addCharacterStep: (gameId: number) => void;
    removeCharacterStep: (gameId: number) => void;
}): JSX.Element {
    return (
        <div className="flex-1 overflow-y-auto px-6 pb-6">
            {currentStepDef?.key === 'connect' && <ConnectStep />}
            {currentStepDef?.key === 'discord-join' && <DiscordJoinStep />}
            {currentStepDef?.key === 'games' && <GamesStep />}
            {isCharacterStep && currentStepDef?.registryGame && (
                <CharacterStep
                    key={currentStepDef.key}
                    preselectedGame={currentStepDef.registryGame}
                    charIndex={currentStepDef.charIndex ?? 0}
                    onRegisterValidator={(fn) => { stepValidatorRef.current = fn; }}
                    onAddAnother={() => addCharacterStep(currentStepDef.registryGame!.id)}
                    onRemoveStep={() => removeCharacterStep(currentStepDef.registryGame!.id)}
                />
            )}
            {currentStepDef?.key === 'gametime' && <GameTimeStep />}
            {currentStepDef?.key === 'avatar' && <AvatarThemeStep />}
        </div>
    );
}

/** Sticky footer with navigation buttons */
function WizardFooter({ isFirstStep, isFinalStep, goBack, goNext, handleComplete, isPending }: {
    isFirstStep: boolean; isFinalStep: boolean; goBack: () => void; goNext: () => void;
    handleComplete: () => void; isPending: boolean;
}): JSX.Element {
    return (
        <div className="flex-shrink-0 border-t border-edge/30 px-6 py-4 flex gap-3 justify-center rounded-b-2xl">
            {!isFirstStep && (
                <button type="button" onClick={goBack} className="px-5 py-2.5 min-h-[44px] bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm">Back</button>
            )}
            {!isFinalStep && (
                <button type="button" onClick={goNext} className="px-5 py-2.5 min-h-[44px] bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm">Skip</button>
            )}
            <button type="button" onClick={isFinalStep ? handleComplete : goNext} disabled={isFinalStep && isPending}
                className="px-6 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-semibold rounded-lg transition-colors text-sm">
                {isFinalStep ? (isPending ? 'Completing...' : 'Complete') : 'Next'}
            </button>
        </div>
    );
}
