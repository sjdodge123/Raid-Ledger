import { TimezoneSection } from '../profile/TimezoneSection';

interface TimezoneStepProps {
    onNext: () => void;
    onBack: () => void;
    onSkip: () => void;
}

/**
 * Step 5: Timezone (ROK-219 redesign).
 * Wraps the existing TimezoneSection component inline.
 */
export function TimezoneStep({ onNext, onBack, onSkip }: TimezoneStepProps) {
    return (
        <div className="space-y-5">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-foreground">Your Timezone</h2>
                <p className="text-muted mt-2">
                    We'll display event times in your local timezone.
                </p>
            </div>

            <div className="max-w-md mx-auto">
                <TimezoneSection />
            </div>

            {/* Navigation */}
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={onSkip}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Skip
                </button>
                <button
                    type="button"
                    onClick={onNext}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors text-sm"
                >
                    Next
                </button>
            </div>
        </div>
    );
}
