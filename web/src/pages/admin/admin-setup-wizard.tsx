import { useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin } from '../../hooks/use-auth';
import { useOnboarding } from '../../hooks/use-onboarding';
import { useSystemStatus } from '../../hooks/use-system-status';
import { toast } from '../../lib/toast';
import { SecureAccountStep } from '../../components/admin/onboarding/secure-account-step';
import { CommunityIdentityStep } from '../../components/admin/onboarding/community-identity-step';
import { LazyDiscordSetupStep } from '../../components/admin/onboarding/discord/discord-setup-step-lazy';
import { DoneStep } from '../../components/admin/onboarding/done-step';

const STEPS = [
  { key: 'secure-account', label: 'Secure Account', number: 1 },
  { key: 'community', label: 'Community', number: 2 },
  { key: 'discord', label: 'Discord', number: 3 },
  { key: 'done', label: 'Done', number: 4 },
] as const;

const MAX_STEP = STEPS.length - 1;
const DISCORD_SETTINGS_PATH = '/admin/settings/discord';

/**
 * ROK-1701 OQ-8b: the cloud flavour skips "Secure Account" (the claim already
 * set the password), so its first step is Community. Server `currentStep`
 * keeps meaning the 4-step list — nothing is renumbered. NAS starts at 0.
 */
function useFirstStep(): number {
  const { data } = useSystemStatus();
  return data?.flavour === 'cloud' ? 1 : 0;
}

/**
 * Admin Setup Wizard (ROK-204).
 * Step-by-step onboarding experience for first-time admins.
 */
function clampStep(step: number, firstStep: number): number { return Math.max(firstStep, Math.min(MAX_STEP, step)); }

function useWizardNavigation(updateStep: ReturnType<typeof useOnboarding>['updateStep'], firstStep: number) {
  const navigate = useNavigate();
  const { completeOnboarding } = useOnboarding();
  const [stepOverride, setStepOverride] = useState<number | null>(null);
  // Where the wizard exits once the refetched status says `completed`. The lazy Admin → Discord route
  // suspends inside the navigate transition, so the still-mounted wizard's completed-redirect would win.
  const [exitTo, setExitTo] = useState<string | null>(null);

  const goToStep = useCallback((step: number) => { const clamped = clampStep(step, firstStep); setStepOverride(clamped); updateStep.mutate(clamped); }, [updateStep, firstStep]);
  const handleSkipAll = useCallback(() => {
    completeOnboarding.mutate(undefined, {
      onSuccess: () => { toast.info('Setup skipped. You can complete it anytime from Admin Settings.'); navigate('/calendar', { replace: true }); },
    });
  }, [completeOnboarding, navigate]);
  const handleComplete = useCallback(() => { completeOnboarding.mutate(undefined, { onSuccess: () => navigate('/calendar', { replace: true }) }); }, [completeOnboarding, navigate]);
  // ROK-1703 D-9: "Finish later" on 4e completes onboarding (as Skip Setup does) and opens Admin → Discord.
  const handleFinishLater = useCallback(() => {
    setExitTo(DISCORD_SETTINGS_PATH);
    completeOnboarding.mutate(undefined, {
      onSuccess: () => { toast.info('Pick a default channel any time in Admin \u2192 Discord'); navigate(DISCORD_SETTINGS_PATH, { replace: true }); },
      onError: () => setExitTo(null),
    });
  }, [completeOnboarding, navigate]);

  return { stepOverride, exitTo, goToStep, handleSkipAll, handleComplete, handleFinishLater };
}

export function AdminSetupWizard() {
  const { user } = useAuth();
  const { statusQuery, updateStep } = useOnboarding();
  const firstStep = useFirstStep();
  const { stepOverride, exitTo, goToStep, handleSkipAll, handleComplete, handleFinishLater } = useWizardNavigation(updateStep, firstStep);

  const currentStep = stepOverride ?? clampStep(statusQuery.data?.currentStep ?? 0, firstStep);
  const goNext = useCallback(() => { if (currentStep < MAX_STEP) goToStep(currentStep + 1); }, [currentStep, goToStep]);
  const goBack = useCallback(() => { if (currentStep > firstStep) goToStep(currentStep - 1); }, [currentStep, firstStep, goToStep]);

  if (user && !isAdmin(user)) return <Navigate to="/calendar" replace />;
  if (statusQuery.data?.completed) return <Navigate to={exitTo ?? '/calendar'} replace />;
  if (statusQuery.isLoading) return <WizardLoading />;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col">
      <WizardHeader onSkip={handleSkipAll} />
      <WizardStepper currentStep={currentStep} firstStep={firstStep} goToStep={goToStep} />
      <WizardStepContent currentStep={currentStep} firstStep={firstStep} goNext={goNext} goBack={goBack} goToStep={goToStep} onComplete={handleComplete} onFinishLater={handleFinishLater} />
    </div>
  );
}

function WizardLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-4 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-muted">Loading setup wizard...</p>
      </div>
    </div>
  );
}

function WizardHeader({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="border-b border-edge/50 bg-panel/30">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Setup Wizard</h1>
          <p className="text-sm text-muted mt-0.5">Let's get your community up and running</p>
        </div>
        <button onClick={onSkip} className="text-sm text-muted hover:text-foreground transition-colors px-4 py-2.5 min-h-[44px] rounded-lg hover:bg-edge/20">
          Skip Setup
        </button>
      </div>
    </div>
  );
}

function WizardStepper({ currentStep, firstStep, goToStep }: { currentStep: number; firstStep: number; goToStep: (i: number) => void }) {
  const visible = STEPS.slice(firstStep);
  return (
    <div className="border-b border-edge/30 bg-panel/10">
      <div className="max-w-4xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between md:hidden">
          <span className="text-sm text-muted">Step {currentStep - firstStep + 1} of {visible.length}</span>
          <span className="text-sm font-medium text-foreground">{STEPS[currentStep]?.label}</span>
        </div>
        <div className="hidden md:flex items-center justify-between">
          {visible.map((step, i) => (
            <WizardStepIndicator key={step.key} step={step} index={firstStep + i} displayNumber={i + 1} currentStep={currentStep} isLast={i === visible.length - 1} onClick={() => goToStep(firstStep + i)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WizardStepIndicator({ step, index, displayNumber, currentStep, isLast, onClick }: {
  step: typeof STEPS[number]; index: number; displayNumber: number; currentStep: number; isLast: boolean; onClick: () => void;
}) {
  const circleClass = index === currentStep
    ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/50'
    : index < currentStep ? 'bg-emerald-600/30 text-emerald-400' : 'bg-surface/50 text-muted border border-edge/50';

  return (
    <button onClick={onClick} className="flex items-center gap-2 group min-h-[44px]">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${circleClass}`}>
        {index < currentStep ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : displayNumber}
      </div>
      <span className={`text-sm font-medium transition-colors ${index === currentStep ? 'text-foreground' : 'text-muted group-hover:text-foreground'}`}>{step.label}</span>
      {!isLast && <div className={`w-8 h-px ml-2 ${index < currentStep ? 'bg-emerald-600/50' : 'bg-edge/50'}`} />}
    </button>
  );
}

function WizardStepContent({ currentStep, firstStep, goNext, goBack, goToStep, onComplete, onFinishLater }: {
  currentStep: number; firstStep: number; goNext: () => void; goBack: () => void; goToStep: (i: number) => void; onComplete: () => void; onFinishLater: () => void;
}) {
  return (
    <div className="flex-1">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {currentStep === 0 && <SecureAccountStep onNext={goNext} onSkip={goNext} />}
        {currentStep === 1 && <CommunityIdentityStep onNext={goNext} onBack={goBack} onSkip={goNext} />}
        {currentStep === 2 && <LazyDiscordSetupStep onNext={goNext} onBack={goBack} onFinishLater={onFinishLater} />}
        {currentStep === 3 && <DoneStep onComplete={onComplete} goToStep={goToStep} firstStep={firstStep} />}
      </div>
    </div>
  );
}
