import { useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin } from '../../hooks/use-auth';
import { useOnboarding } from '../../hooks/use-onboarding';
import { toast } from '../../lib/toast';
import { SecureAccountStep } from '../../components/admin/onboarding/secure-account-step';
import { CommunityIdentityStep } from '../../components/admin/onboarding/community-identity-step';
import { ConnectPluginsStep } from '../../components/admin/onboarding/connect-plugins-step';
import { DoneStep } from '../../components/admin/onboarding/done-step';

const STEPS = [
  { key: 'secure-account', label: 'Secure Account', number: 1 },
  { key: 'community', label: 'Community', number: 2 },
  { key: 'plugins', label: 'Plugins', number: 3 },
  { key: 'done', label: 'Done', number: 4 },
] as const;

const MAX_STEP = STEPS.length - 1;

/**
 * Admin Setup Wizard (ROK-204).
 * Step-by-step onboarding experience for first-time admins.
 */
export function AdminSetupWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { statusQuery, updateStep, completeOnboarding } = useOnboarding();

  // Local override: null means "use server step", number means "user navigated"
  const [stepOverride, setStepOverride] = useState<number | null>(null);
  const serverStep = statusQuery.data?.currentStep ?? 0;
  const currentStep = stepOverride ?? Math.min(serverStep, MAX_STEP);

  const goToStep = useCallback(
    (step: number) => {
      const clamped = Math.max(0, Math.min(MAX_STEP, step));
      setStepOverride(clamped);
      updateStep.mutate(clamped);
    },
    [updateStep],
  );

  const goNext = useCallback(() => {
    if (currentStep < MAX_STEP) {
      goToStep(currentStep + 1);
    }
  }, [currentStep, goToStep]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  }, [currentStep, goToStep]);

  const handleSkipAll = useCallback(() => {
    completeOnboarding.mutate(undefined, {
      onSuccess: () => {
        toast.info(
          'Setup skipped. You can complete it anytime from Admin Settings.',
        );
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

  // Redirect non-admin users (AC-10)
  if (user && !isAdmin(user)) {
    return <Navigate to="/calendar" replace />;
  }

  // Redirect if onboarding is already completed
  if (statusQuery.data?.completed) {
    return <Navigate to="/calendar" replace />;
  }

  if (statusQuery.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-muted">Loading setup wizard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col">
      {/* Header with skip-all */}
      <div className="border-b border-edge/50 bg-panel/30">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Setup Wizard
            </h1>
            <p className="text-sm text-muted mt-0.5">
              Let's get your community up and running
            </p>
          </div>
          <button
            onClick={handleSkipAll}
            className="text-sm text-muted hover:text-foreground transition-colors underline underline-offset-2"
          >
            Skip Setup
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="border-b border-edge/30 bg-panel/10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => (
              <button
                key={step.key}
                onClick={() => goToStep(index)}
                className="flex items-center gap-2 group"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                    index === currentStep
                      ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/50'
                      : index < currentStep
                        ? 'bg-emerald-600/30 text-emerald-400'
                        : 'bg-surface/50 text-muted border border-edge/50'
                  }`}
                >
                  {index < currentStep ? (
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    step.number
                  )}
                </div>
                <span
                  className={`text-sm font-medium hidden sm:block transition-colors ${
                    index === currentStep
                      ? 'text-foreground'
                      : 'text-muted group-hover:text-foreground'
                  }`}
                >
                  {step.label}
                </span>
                {index < STEPS.length - 1 && (
                  <div
                    className={`hidden sm:block w-8 h-px ml-2 ${
                      index < currentStep
                        ? 'bg-emerald-600/50'
                        : 'bg-edge/50'
                    }`}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {currentStep === 0 && (
            <SecureAccountStep onNext={goNext} onSkip={goNext} />
          )}
          {currentStep === 1 && (
            <CommunityIdentityStep
              onNext={goNext}
              onBack={goBack}
              onSkip={goNext}
            />
          )}
          {currentStep === 2 && (
            <ConnectPluginsStep
              onNext={goNext}
              onBack={goBack}
              onSkip={goNext}
            />
          )}
          {currentStep === 3 && (
            <DoneStep onComplete={handleComplete} goToStep={goToStep} />
          )}
        </div>
      </div>
    </div>
  );
}
