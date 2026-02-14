import { useState, useCallback, useEffect, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin } from '../hooks/use-auth';
import { useCompleteOnboardingFte } from '../hooks/use-onboarding-fte';
import { toast } from '../lib/toast';
import { WelcomeStep } from '../components/onboarding/welcome-step';
import { GamesStep } from '../components/onboarding/games-step';
import { CharacterStep } from '../components/onboarding/character-step';
import { AvailabilityStep } from '../components/onboarding/availability-step';
import { DoneStep } from '../components/onboarding/done-step';

/**
 * Step definitions for the FTE wizard.
 * Step 3 (character) is conditionally included based on MMO game selection.
 */
const BASE_STEPS = [
    { key: 'welcome', label: 'Welcome', number: 1 },
    { key: 'games', label: 'Games', number: 2 },
    { key: 'character', label: 'Character', number: 3 },
    { key: 'availability', label: 'Availability', number: 4 },
    { key: 'done', label: 'Done', number: 5 },
] as const;

/**
 * FTE Onboarding Wizard Page (ROK-219).
 * Centered modal overlay for first-time users.
 * All steps are skippable. Escape dismisses the entire wizard.
 */
export function OnboardingWizardPage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const completeOnboarding = useCompleteOnboardingFte();

    const [currentStep, setCurrentStep] = useState(0);
    const [hasMMO, setHasMMO] = useState(false);

    // Build active steps list — exclude character step if no MMO games
    const steps = useMemo(
        () =>
            hasMMO
                ? BASE_STEPS
                : BASE_STEPS.filter((s) => s.key !== 'character'),
        [hasMMO],
    );

    const maxStep = steps.length - 1;
    const currentStepDef = steps[currentStep];

    const goNext = useCallback(() => {
        setCurrentStep((prev) => Math.min(prev + 1, maxStep));
    }, [maxStep]);

    const goBack = useCallback(() => {
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

    const handleGamesNext = useCallback(
        (mmoDetected: boolean) => {
            setHasMMO(mmoDetected);
            goNext();
        },
        [goNext],
    );

    // Keyboard navigation: Escape to dismiss
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
    if (user?.onboardingCompletedAt) {
        return <Navigate to="/calendar" replace />;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                className="relative w-full max-w-[640px] max-h-[80vh] overflow-y-auto bg-surface border border-edge/50 rounded-2xl shadow-2xl"
                role="dialog"
                aria-label="Onboarding wizard"
            >
                {/* Header with Skip All */}
                <div className="sticky top-0 z-10 bg-surface border-b border-edge/30 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div className="text-sm text-muted">
                        Step {currentStep + 1} of {steps.length}
                    </div>
                    {currentStepDef?.key !== 'done' && (
                        <button
                            onClick={handleSkipAll}
                            className="text-sm text-muted hover:text-foreground transition-colors underline underline-offset-2"
                        >
                            Skip All
                        </button>
                    )}
                </div>

                {/* Progress dots */}
                <div className="px-6 py-3 flex items-center justify-center gap-2">
                    {steps.map((step, index) => (
                        <div
                            key={step.key}
                            className={`w-2 h-2 rounded-full transition-all ${
                                index === currentStep
                                    ? 'w-6 bg-emerald-500'
                                    : index < currentStep
                                      ? 'bg-emerald-500/50'
                                      : 'bg-edge/50'
                            }`}
                        />
                    ))}
                </div>

                {/* Step content */}
                <div className="px-6 pb-6">
                    {currentStepDef?.key === 'welcome' && (
                        <WelcomeStep onNext={goNext} onSkip={goNext} />
                    )}
                    {currentStepDef?.key === 'games' && (
                        <GamesStep
                            onNext={handleGamesNext}
                            onBack={goBack}
                            onSkip={goNext}
                        />
                    )}
                    {currentStepDef?.key === 'character' && (
                        <CharacterStep
                            onNext={goNext}
                            onBack={goBack}
                            onSkip={goNext}
                        />
                    )}
                    {currentStepDef?.key === 'availability' && (
                        <AvailabilityStep
                            onNext={goNext}
                            onBack={goBack}
                            onSkip={goNext}
                        />
                    )}
                    {currentStepDef?.key === 'done' && (
                        <DoneStep
                            onComplete={handleComplete}
                            isCompleting={completeOnboarding.isPending}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
