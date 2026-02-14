interface DoneStepProps {
    onComplete: () => void;
    isCompleting: boolean;
}

/**
 * Step 5: All Set! (ROK-219).
 * Summary and celebration, triggers onboardingCompletedAt.
 */
export function DoneStep({ onComplete, isCompleting }: DoneStepProps) {
    return (
        <div className="text-center space-y-6">
            <div>
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg
                        className="w-10 h-10 text-emerald-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-foreground">You're All Set!</h2>
                <p className="text-muted mt-2">
                    Your profile is ready. You can always update your settings from your profile page.
                </p>
            </div>

            <div className="max-w-sm mx-auto space-y-3">
                <div className="bg-panel border border-edge/50 rounded-lg p-4 text-left space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                        <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-foreground">Browse upcoming events on the calendar</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-foreground">Sign up for raids with your characters</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-foreground">Connect with other players in your community</span>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onComplete}
                    disabled={isCompleting}
                    className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-semibold rounded-lg transition-colors"
                >
                    {isCompleting ? 'Finishing up...' : 'Go to Calendar'}
                </button>
            </div>
        </div>
    );
}
