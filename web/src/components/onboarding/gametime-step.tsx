import { useEffect, useRef } from 'react';
import { GameTimeGrid } from '../features/game-time/GameTimeGrid';
import { AbsenceSection } from '../features/game-time/game-time-absence';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';

/**
 * Step 4: When Do You Play? (ROK-219).
 * Reuses the GameTimeGrid component for drag-to-paint availability on desktop,
 * and GameTimeMobileEditor (toggle list) on mobile (<768px).
 * Auto-saves when user navigates away via wizard footer.
 */
function useAutoSaveOnUnmount(save: () => void, isDirty: boolean) {
    const saveRef = useRef(save);
    const isDirtyRef = useRef(isDirty);
    useEffect(() => {
        saveRef.current = save;
        isDirtyRef.current = isDirty;
    });
    useEffect(() => {
        return () => {
            if (isDirtyRef.current) saveRef.current();
        };
    }, []);
}

function GameTimeStepHeader() {
    return (
        <div className="text-center mb-2">
            <h2 className="text-lg font-bold text-foreground">When Do You Play?</h2>
            <p className="text-muted text-sm mt-1">Paint your weekly availability. Click and drag to mark hours you&apos;re free.</p>
        </div>
    );
}

function GameTimeStepLoading() {
    return (
        <div className="text-center py-8">
            <div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-dim text-sm">Loading...</p>
        </div>
    );
}

function GameTimeStepGrid({ slots, handleChange, tzLabel }: {
    slots: ReturnType<typeof useGameTimeEditor>['slots'];
    handleChange: ReturnType<typeof useGameTimeEditor>['handleChange']; tzLabel: string;
}) {
    return <GameTimeGrid slots={slots} onChange={handleChange} tzLabel={tzLabel} hourRange={[9, 24]} fullDayNames compact noStickyOffset />;
}

export function GameTimeStep() {
    const { slots, isLoading, isDirty, handleChange, save, tzLabel } = useGameTimeEditor({ enabled: true, rolling: false });
    useAutoSaveOnUnmount(save, isDirty);

    return (
        <div>
            <GameTimeStepHeader />
            <div className="max-w-2xl mx-auto">
                {isLoading ? <GameTimeStepLoading /> : (
                    <>
                        <GameTimeStepGrid slots={slots} handleChange={handleChange} tzLabel={tzLabel} />
                        <div className="mt-3"><AbsenceSection /></div>
                    </>
                )}
            </div>
        </div>
    );
}
