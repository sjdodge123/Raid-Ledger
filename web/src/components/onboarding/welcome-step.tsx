import { useState } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useCheckDisplayName, useUpdateUserProfile } from '../../hooks/use-onboarding-fte';

interface WelcomeStepProps {
    onNext: () => void;
    onSkip: () => void;
}

/**
 * Step 1: Welcome & Display Name (ROK-219).
 * Pre-fills from Discord username, validates 2-30 chars with uniqueness check.
 */
export function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
    const { user } = useAuth();
    const [displayName, setDisplayName] = useState(() => user?.displayName ?? user?.username ?? '');
    const [touched, setTouched] = useState(false);

    const { data: availability, isLoading: checkingName } = useCheckDisplayName(
        touched ? displayName : '',
    );
    const updateProfile = useUpdateUserProfile();

    const isValidLength = displayName.length >= 2 && displayName.length <= 30;
    const isAvailable = availability?.available ?? true;
    const canSubmit = isValidLength && isAvailable && !checkingName;

    const handleSubmit = () => {
        if (!canSubmit) return;
        updateProfile.mutate(displayName, {
            onSuccess: () => onNext(),
        });
    };

    return (
        <div className="text-center space-y-6">
            <div>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-foreground">Welcome to Raid Ledger!</h2>
                <p className="text-muted mt-2">Let's set up your profile. Choose a display name that other players will see.</p>
            </div>

            <div className="max-w-sm mx-auto space-y-2">
                <label htmlFor="display-name" className="block text-sm font-medium text-foreground text-left">
                    Display Name
                </label>
                <input
                    id="display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => {
                        setDisplayName(e.target.value);
                        if (!touched) setTouched(true);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSubmit) handleSubmit();
                    }}
                    placeholder="Your display name"
                    maxLength={30}
                    className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
                    autoFocus
                />
                <div className="flex items-center justify-between text-xs">
                    <span className={displayName.length > 0 && !isValidLength ? 'text-red-400' : 'text-dim'}>
                        {displayName.length}/30 characters (min 2)
                    </span>
                    {touched && displayName.length >= 2 && (
                        <span className={checkingName ? 'text-dim' : isAvailable ? 'text-emerald-400' : 'text-red-400'}>
                            {checkingName ? 'Checking...' : isAvailable ? 'Available' : 'Taken'}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex gap-3 justify-center max-w-sm mx-auto">
                <button
                    type="button"
                    onClick={onSkip}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Skip
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit || updateProfile.isPending}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-medium rounded-lg transition-colors text-sm"
                >
                    {updateProfile.isPending ? 'Saving...' : 'Next'}
                </button>
            </div>
        </div>
    );
}
