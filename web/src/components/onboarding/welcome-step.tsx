interface WelcomeStepProps {
    onNext: () => void;
    onSkip: () => void;
}

function WelcomeHeader() {
    return (
        <div>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground">Welcome to Raid Ledger!</h2>
            <p className="text-muted mt-2">We'll get you set up so you can start joining events.</p>
        </div>
    );
}

export function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
    return (
        <div className="text-center space-y-6">
            <WelcomeHeader />
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
                <button type="button" onClick={onSkip} className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm">Skip</button>
                <button type="button" onClick={onNext} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors text-sm">Continue</button>
            </div>
        </div>
    );
}
