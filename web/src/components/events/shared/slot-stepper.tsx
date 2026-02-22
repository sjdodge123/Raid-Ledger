/**
 * Number stepper for slot counts. Used in both create-event-form and plan-event-form.
 */
export function SlotStepper({ label, value, onChange, color, min = 0, max = 99 }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    color: string;
    min?: number;
    max?: number;
}) {
    return (
        <div className="flex items-center justify-between gap-3 py-2 min-h-[44px] sm:min-h-0">
            <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${color}`} />
                <span className="text-sm text-secondary font-medium">{label}</span>
            </div>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => onChange(Math.max(min, value - 1))}
                    disabled={value <= min}
                    className="w-11 h-11 sm:w-8 sm:h-8 rounded-md bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-lg font-medium"
                >
                    -
                </button>
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
                    }}
                    className="w-14 h-11 sm:w-12 sm:h-8 bg-panel border border-edge rounded-md text-foreground text-center text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                    type="button"
                    onClick={() => onChange(Math.min(max, value + 1))}
                    disabled={value >= max}
                    className="w-11 h-11 sm:w-8 sm:h-8 rounded-md bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-lg font-medium"
                >
                    +
                </button>
            </div>
        </div>
    );
}
