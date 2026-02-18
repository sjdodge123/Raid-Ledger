import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, isAdmin } from '../hooks/use-auth';
import { useCompleteOnboardingFte } from '../hooks/use-onboarding-fte';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useUserHeartedGames } from '../hooks/use-user-profile';
import { useMyCharacters } from '../hooks/use-characters';
import { toast } from '../lib/toast';
import { ConnectStep } from '../components/onboarding/connect-step';
import { GamesStep } from '../components/onboarding/games-step';
import { CharacterStep } from '../components/onboarding/character-step';
import { GameTimeStep } from '../components/onboarding/gametime-step';
import { AvatarThemeStep } from '../components/onboarding/avatar-theme-step';
import type { GameRegistryDto } from '@raid-ledger/contract';

interface StepDef {
    /** Unique key — 'character-gameId-0', 'character-gameId-1', etc. for dynamic character steps */
    key: string;
    label: string;
    /** For character steps, the registry game to pre-fill */
    registryGame?: GameRegistryDto;
    /** For character steps, which character slot this step represents (0-based) */
    charIndex?: number;
}

/**
 * Breadcrumb label for the Connect step — shows Discord avatar + name
 * when connected, falls back to dot + "Connect" when not.
 */
function ConnectStepLabel({ user, isCurrent, isVisited }: {
    user: { avatar: string | null; displayName: string | null; username: string; discordId: string } | null;
    isCurrent: boolean;
    isVisited: boolean;
}) {
    const isConnected = user && user.discordId && !user.discordId.startsWith('local:');

    if (isConnected) {
        return (
            <>
                {user.avatar ? (
                    <img
                        src={user.avatar}
                        alt={user.displayName || user.username}
                        className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                    />
                ) : (
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCurrent
                        ? 'bg-white'
                        : isVisited
                            ? 'bg-emerald-400'
                            : 'bg-edge/50'
                        }`} />
                )}
                <span className="truncate max-w-[6rem]">{user.displayName || user.username}</span>
            </>
        );
    }

    return (
        <>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCurrent
                ? 'bg-white'
                : isVisited
                    ? 'bg-emerald-400'
                    : 'bg-edge/50'
                }`} />
            Connect
        </>
    );
}

/**
 * Breadcrumb label for character steps — shows avatar + name when saved,
 * falls back to game name + dot when empty.
 */
function CharacterStepLabel({ game, charIndex, isCurrent, isVisited }: {
    game: GameRegistryDto;
    charIndex: number;
    isCurrent: boolean;
    isVisited: boolean;
}) {
    const { data: myCharsData } = useMyCharacters(game.id);
    const chars = myCharsData?.data ?? [];
    const char = chars[charIndex];

    if (char) {
        return (
            <>
                {char.avatarUrl ? (
                    <img
                        src={char.avatarUrl}
                        alt={char.name}
                        className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                    />
                ) : (
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCurrent
                        ? 'bg-white'
                        : isVisited
                            ? 'bg-emerald-400'
                            : 'bg-edge/50'
                        }`} />
                )}
                <span className="truncate max-w-[6rem]">{char.name}</span>
            </>
        );
    }

    return (
        <>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCurrent
                ? 'bg-white'
                : isVisited
                    ? 'bg-emerald-400'
                    : 'bg-edge/50'
                }`} />
            {game.name}
        </>
    );
}

/**
 * FTE Onboarding Wizard Page (ROK-219 redesign).
 * Step flow: Connect (conditional) -> Games -> Character × N (per qualifying hearted game) -> Game Time -> Personalize
 * Centered modal overlay. All steps are skippable. Escape dismisses.
 * Re-runnable from settings via /onboarding?rerun=1.
 */
export function OnboardingWizardPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const completeOnboarding = useCompleteOnboardingFte();
    const { games: registryGames } = useGameRegistry();
    const { data: heartedGamesData } = useUserHeartedGames(user?.id);

    const [currentStep, setCurrentStep] = useState(0);
    // Extra character steps beyond the initial one per game
    const [extraCharCounts, setExtraCharCounts] = useState<Record<string, number>>({});

    const isRerun = searchParams.get('rerun') === '1';

    // Determine if user needs the connect step (no OAuth linked)
    const needsConnect = useMemo(() => {
        if (!user) return false;
        return !user.discordId || user.discordId.startsWith('local:');
    }, [user]);

    // Qualifying games = hearted games that exist in the game registry (by name).
    // We match by name because IGDB slugs differ from registry slugs
    // (e.g. IGDB: "world-of-warcraft" vs registry: "wow").
    const qualifyingGames = useMemo(() => {
        const hearted = heartedGamesData?.data ?? [];
        if (hearted.length === 0 || registryGames.length === 0) return [];
        const registryByName = new Map(
            registryGames.map((g) => [g.name.toLowerCase(), g]),
        );
        return hearted
            .map((h) => registryByName.get(h.name.toLowerCase()))
            .filter((g): g is GameRegistryDto => !!g);
    }, [heartedGamesData, registryGames]);

    // Build active steps list dynamically
    const steps: StepDef[] = useMemo(() => {
        const s: StepDef[] = [];
        if (needsConnect) s.push({ key: 'connect', label: 'Connect' });
        s.push({ key: 'games', label: 'Games' });
        // Character steps: 1 initial + extras per qualifying hearted game
        qualifyingGames.forEach((game) => {
            const total = 1 + (extraCharCounts[game.id] ?? 0);
            for (let j = 0; j < total; j++) {
                s.push({
                    key: `character-${game.id}-${j}`,
                    label: total > 1 ? `${game.name} (${j + 1})` : game.name,
                    registryGame: game,
                    charIndex: j,
                });
            }
        });
        s.push({ key: 'gametime', label: 'Game Time' });
        s.push({ key: 'avatar', label: 'Personalize' });
        return s;
    }, [needsConnect, qualifyingGames, extraCharCounts]);

    const maxStep = steps.length - 1;
    const currentStepDef = steps[currentStep];

    // Validator ref — character steps can register a function that returns false
    // to block advancing (e.g. unsaved Armory preview). Reset when step changes.
    const stepValidatorRef = useRef<(() => boolean) | null>(null);

    const goNext = useCallback(() => {
        if (stepValidatorRef.current && !stepValidatorRef.current()) {
            return; // validator blocked — step will show warning
        }
        stepValidatorRef.current = null;
        setCurrentStep((prev) => Math.min(prev + 1, maxStep));
    }, [maxStep]);

    const goBack = useCallback(() => {
        setCurrentStep((prev) => Math.max(prev - 1, 0));
    }, []);

    // Add another character step for a game — inserts right after current step
    const addCharacterStep = useCallback((gameId: string) => {
        setExtraCharCounts((prev) => ({ ...prev, [gameId]: (prev[gameId] ?? 0) + 1 }));
        // Advance to the newly created step (which appears right after current)
        setCurrentStep((prev) => prev + 1);
    }, []);

    // Remove an extra character step for a game — collapse back
    const removeCharacterStep = useCallback((gameId: string) => {
        setExtraCharCounts((prev) => {
            const current = prev[gameId] ?? 0;
            if (current <= 0) return prev;
            return { ...prev, [gameId]: current - 1 };
        });
        // Navigate back since this step is being removed
        setCurrentStep((prev) => Math.max(prev - 1, 0));
    }, []);

    const handleSkipAll = useCallback(() => {
        completeOnboarding.mutate(undefined, {
            onSuccess: () => {
                toast.info('Setup skipped. You can update your profile anytime.');
                navigate('/calendar', { replace: true });
            },
        });
    }, [completeOnboarding, navigate]);

    const handleComplete = useCallback(() => {
        completeOnboarding.mutate(undefined, {
            onSuccess: () => {
                navigate('/calendar', { replace: true });
            },
        });
    }, [completeOnboarding, navigate]);

    // Keyboard: Escape to dismiss
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleSkipAll();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSkipAll]);

    // Redirect guards — placed after all hooks
    if (user && isAdmin(user)) {
        return <Navigate to="/calendar" replace />;
    }
    // Allow re-run from settings (skip the onboardingCompletedAt guard)
    if (user?.onboardingCompletedAt && !isRerun) {
        return <Navigate to="/calendar" replace />;
    }

    const isFirstStep = currentStep === 0;
    const isFinalStep = currentStepDef?.key === 'avatar';
    const isCharacterStep = currentStepDef?.key.startsWith('character-');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                className="relative w-full max-w-2xl mx-4 h-[90vh] flex flex-col bg-surface border border-edge/50 rounded-2xl shadow-2xl"
                role="dialog"
                aria-label="Onboarding wizard"
            >
                {/* Header with Skip All — sticky, not scrollable */}
                <div className="flex-shrink-0 border-b border-edge/30 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div className="text-sm text-muted">
                        Step {currentStep + 1} of {steps.length}
                    </div>
                    {!isFinalStep && (
                        <button
                            onClick={handleSkipAll}
                            className="text-sm text-muted hover:text-foreground transition-colors px-4 py-2.5 min-h-[44px] rounded-full hover:bg-edge/20"
                        >
                            Skip All
                        </button>
                    )}
                </div>

                {/* Breadcrumbs — hybrid collapse: current ±1 expanded, rest collapsed to dots, hover to expand */}
                <div className="flex-shrink-0 px-4 py-2 flex items-center justify-center gap-0.5">
                    {steps.map((step, index) => {
                        const distance = Math.abs(index - currentStep);
                        const isExpanded = distance <= 1;

                        const isCurrent = index === currentStep;
                        const isVisited = index < currentStep;

                        // Label content (shared for expanded + hover-expanded)
                        const labelContent = step.key === 'connect' ? (
                            <ConnectStepLabel
                                user={user ?? null}
                                isCurrent={isCurrent}
                                isVisited={isVisited}
                            />
                        ) : step.registryGame != null && step.charIndex != null ? (
                            <CharacterStepLabel
                                game={step.registryGame}
                                charIndex={step.charIndex}
                                isCurrent={isCurrent}
                                isVisited={isVisited}
                            />
                        ) : (
                            <>
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCurrent
                                    ? 'bg-white'
                                    : isVisited ? 'bg-emerald-400' : 'bg-edge/50'
                                    }`} />
                                {step.label}
                            </>
                        );

                        const dotColor = isVisited || isCurrent ? 'bg-emerald-400' : 'bg-edge/50';

                        return (
                            <button
                                key={step.key}
                                type="button"
                                onClick={() => setCurrentStep(index)}
                                className={`group relative flex items-center justify-center rounded-full text-xs font-medium
                                    transition-all duration-300 ease-in-out min-w-[44px] min-h-[44px]
                                    ${isCurrent
                                        ? 'bg-emerald-600 text-white px-2.5 py-1.5'
                                        : isVisited
                                            ? 'text-emerald-400 hover:bg-emerald-500/10 cursor-pointer px-1.5 py-1.5'
                                            : 'text-dim hover:bg-edge/20 cursor-pointer px-1.5 py-1.5'
                                    }`}
                            >
                                {/* Collapsed dot — shrinks to 0 when step is expanded via proximity */}
                                <span className={`rounded-full flex-shrink-0 transition-all duration-300 ease-in-out ${dotColor} ${isExpanded ? 'w-0 h-0 opacity-0' : 'w-3 h-3 opacity-100'
                                    }`} />
                                {/* In-flow label — visible when expanded by proximity */}
                                <span className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap
                                    transition-all duration-300 ease-in-out
                                    ${isExpanded ? 'max-w-[12rem] opacity-100' : 'max-w-0 opacity-0'
                                    }`}>
                                    {labelContent}
                                    {step.charIndex != null && step.charIndex > 0 && step.registryGame && (
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeCharacterStep(step.registryGame!.id);
                                            }}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeCharacterStep(step.registryGame!.id); } }}
                                            className="ml-0.5 w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-500/30 text-current opacity-60 hover:opacity-100 transition-all flex-shrink-0"
                                            title="Remove this character slot"
                                        >
                                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </span>
                                    )}
                                </span>
                                {/* Hover overlay — absolute, same level, expands in place from the dot */}
                                {!isExpanded && (
                                    <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                                        flex items-center gap-1.5 whitespace-nowrap
                                        rounded-full px-2.5 py-1.5
                                        text-xs font-medium
                                        opacity-0 scale-90 pointer-events-none
                                        group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto
                                        transition-all duration-200 ease-out
                                        ${isVisited
                                            ? 'bg-surface text-emerald-400 shadow-lg shadow-black/30'
                                            : 'bg-surface text-dim shadow-lg shadow-black/30'
                                        }
                                    `}>
                                        {labelContent}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Scrollable step content */}
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                    {currentStepDef?.key === 'connect' && (
                        <ConnectStep />
                    )}
                    {currentStepDef?.key === 'games' && (
                        <GamesStep />
                    )}
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
                    {currentStepDef?.key === 'gametime' && (
                        <GameTimeStep />
                    )}
                    {currentStepDef?.key === 'avatar' && (
                        <AvatarThemeStep />
                    )}
                </div>

                {/* Sticky footer — navigation buttons */}
                <div className="flex-shrink-0 border-t border-edge/30 px-6 py-4 flex gap-3 justify-center rounded-b-2xl">
                    {!isFirstStep && (
                        <button
                            type="button"
                            onClick={goBack}
                            className="px-5 py-2.5 min-h-[44px] bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                        >
                            Back
                        </button>
                    )}
                    {!isFinalStep && (
                        <button
                            type="button"
                            onClick={goNext}
                            className="px-5 py-2.5 min-h-[44px] bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                        >
                            Skip
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={isFinalStep ? handleComplete : goNext}
                        disabled={isFinalStep && completeOnboarding.isPending}
                        className="px-6 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-semibold rounded-lg transition-colors text-sm"
                    >
                        {isFinalStep
                            ? (completeOnboarding.isPending ? 'Finishing...' : 'Finish Setup')
                            : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
}
