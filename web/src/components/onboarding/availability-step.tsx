import { GameTimeGrid } from '../features/game-time/GameTimeGrid';
import { AbsenceSection } from '../features/game-time/game-time-absence';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';

interface AvailabilityStepProps {
    onNext: () => void;
    onBack: () => void;
    onSkip: () => void;
}

/**
 * Step 4: When Do You Play? (ROK-219).
 * Reuses the GameTimeGrid component for drag-to-paint availability.
 */
const NAV_BTN_CLS = 'flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm';

function AvailabilityNavigation({ onBack, onSkip, onNext, isSaving }: { onBack: () => void; onSkip: () => void; onNext: () => void; isSaving: boolean }) {
    return (
        <div className="flex gap-3 justify-center max-w-sm mx-auto">
            <button type="button" onClick={onBack} className={NAV_BTN_CLS}>Back</button>
            <button type="button" onClick={onSkip} className={NAV_BTN_CLS}>Skip</button>
            <button type="button" onClick={onNext} disabled={isSaving} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-medium rounded-lg transition-colors text-sm">
                {isSaving ? 'Saving...' : 'Next'}
            </button>
        </div>
    );
}

export function AvailabilityStep({ onNext, onBack, onSkip }: AvailabilityStepProps) {
    const { slots, isLoading, isDirty, handleChange, save, isSaving, tzLabel } = useGameTimeEditor({ enabled: true, rolling: false });

    const handleNext = async () => { if (isDirty) await save(); onNext(); };

    return (
        <div className="space-y-5">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-foreground">When Do You Play?</h2>
                <p className="text-muted mt-2">Paint your typical weekly availability. Click and drag to mark hours you're usually free.</p>
            </div>
            <div className="max-w-2xl mx-auto">
                {isLoading ? (
                    <div className="text-center py-8"><div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /><p className="text-dim text-sm">Loading...</p></div>
                ) : (
                    <>
                        <GameTimeGrid slots={slots} onChange={handleChange} tzLabel={tzLabel} hourRange={[6, 24]} fullDayNames />
                        <div className="mt-3"><AbsenceSection /></div>
                    </>
                )}
            </div>
            <AvailabilityNavigation onBack={onBack} onSkip={onSkip} onNext={handleNext} isSaving={isSaving} />
        </div>
    );
}
