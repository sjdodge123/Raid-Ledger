import { GameTimeGrid } from '../features/game-time/GameTimeGrid';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';
import { useEffect, useRef } from 'react';

/**
 * Step 4: When Do You Play? (ROK-219).
 * Reuses the GameTimeGrid component for drag-to-paint availability.
 * Auto-saves when user navigates away via wizard footer.
 */
export function GameTimeStep() {
    const {
        slots,
        isLoading,
        isDirty,
        handleChange,
        save,
        tzLabel,
    } = useGameTimeEditor({ enabled: true, rolling: false });

    // Auto-save dirty state when navigating away (unmount)
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

    return (
        <div>
            <div className="text-center mb-2">
                <h2 className="text-lg font-bold text-foreground">When Do You Play?</h2>
                <p className="text-muted text-sm mt-1">
                    Paint your weekly availability. Click and drag to mark hours you're free.
                </p>
            </div>

            <div className="max-w-2xl mx-auto">
                {isLoading ? (
                    <div className="text-center py-8">
                        <div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-dim text-sm">Loading...</p>
                    </div>
                ) : (
                    <GameTimeGrid
                        slots={slots}
                        onChange={handleChange}
                        tzLabel={tzLabel}
                        hourRange={[6, 24]}
                        fullDayNames
                        compact
                    />
                )}
            </div>

        </div>
    );
}
