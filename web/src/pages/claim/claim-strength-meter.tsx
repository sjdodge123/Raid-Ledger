import type { JSX } from 'react';
import type { StrengthLevel } from './claim.helpers';

const BAR_FILL: Record<Exclude<StrengthLevel, 0>, string> = { 1: 'bg-danger', 2: 'bg-warning', 3: 'bg-success', 4: 'bg-danger' };

/** Three length-based strength bars (ROK-1701; level 4 = too long, all red); decorative — the hint carries the meaning. */
export function ClaimStrengthMeter({ level }: { level: StrengthLevel }): JSX.Element {
    return (
        <div className="mt-2 flex gap-1.5" aria-hidden="true" data-testid="claim-strength-meter" data-level={level}>
            {([1, 2, 3] as const).map((bar) => (
                <span key={bar} className={`h-1 flex-1 rounded-full ${level !== 0 && level >= bar ? BAR_FILL[level] : 'bg-edge'}`} />
            ))}
        </div>
    );
}
