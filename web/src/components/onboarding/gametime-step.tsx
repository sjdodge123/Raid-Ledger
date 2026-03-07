import { GameTimeGrid } from '../features/game-time/GameTimeGrid';
import { GameTimeMobileEditor } from '../features/game-time/GameTimeMobileEditor';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';
import { useMediaQuery } from '../../hooks/use-media-query';
import { useEffect, useRef } from 'react';

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

function GameTimeStepHeader({ isMobile }: { isMobile: boolean }) {
    return (
        <div className="text-center mb-2">
            <h2 className="text-lg font-bold text-foreground">When Do You Play?</h2>
            <p className="text-muted text-sm mt-1">
                {isMobile
                    ? 'Tap days to expand and toggle hours you\'re free.'
                    : 'Paint your weekly availability. Click and drag to mark hours you\'re free.'}
            </p>
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

function GameTimeStepGrid({ isMobile, slots, handleChange, tzLabel }: {
    isMobile: boolean; slots: ReturnType<typeof useGameTimeEditor>['slots'];
    handleChange: ReturnType<typeof useGameTimeEditor>['handleChange']; tzLabel: string;
}) {
    if (isMobile) {
        return <GameTimeMobileEditor slots={slots} onChange={handleChange} tzLabel={tzLabel} />;
    }
    return <GameTimeGrid slots={slots} onChange={handleChange} tzLabel={tzLabel} hourRange={[6, 24]} fullDayNames compact />;
}

export function GameTimeStep() {
    const { slots, isLoading, isDirty, handleChange, save, tzLabel } = useGameTimeEditor({ enabled: true, rolling: false });
    const isMobile = useMediaQuery('(max-width: 767px)');
    useAutoSaveOnUnmount(save, isDirty);

    return (
        <div>
            <GameTimeStepHeader isMobile={isMobile} />
            <div className="max-w-2xl mx-auto">
                {isLoading ? <GameTimeStepLoading /> : <GameTimeStepGrid isMobile={isMobile} slots={slots} handleChange={handleChange} tzLabel={tzLabel} />}
            </div>
        </div>
    );
}
