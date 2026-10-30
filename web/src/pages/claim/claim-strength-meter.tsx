import type { JSX } from 'react';

const BAR_FILL: Record<1 | 2 | 3, string> = { 1: 'bg-danger', 2: 'bg-warning', 3: 'bg-success' };

/** Three length-based strength bars (ROK-1701); decorative — the hint text carries the meaning. */
export function ClaimStrengthMeter({ level }: { level: 0 | 1 | 2 | 3 }): JSX.Element {
    return (
        <div className="mt-2 flex gap-1.5" aria-hidden="true" data-testid="claim-strength-meter" data-level={level}>
            {([1, 2, 3] as const).map((bar) => (
                <span key={bar} className={`h-1 flex-1 rounded-full ${level >= bar && level > 0 ? BAR_FILL[level as 1 | 2 | 3] : 'bg-edge'}`} />
            ))}
        </div>
    );
}
