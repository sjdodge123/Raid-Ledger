/**
 * ROK-1743: "Saved instances" on the WoW: Forever character page — the raid
 * and dungeon lockouts from the addon snapshot (name · difficulty · killed/
 * total · "Resets in …"). Rows whose reset has passed are dropped, and the
 * card renders nothing when none remain (no empty state).
 */
import type { CharacterLockoutDto, CharacterLockoutsDto } from '@raid-ledger/contract';
import { formatAddonSourceLine } from '../lib/addon-source-line';
import { formatResetIn } from '../lib/lockout-reset';

interface LockoutRow { lockout: CharacterLockoutDto; resetIn: string }

/** Keeps only lockouts that have not reset yet, paired with their countdown. */
function activeRows(instances: CharacterLockoutDto[], nowMs: number): LockoutRow[] {
    return instances.flatMap((lockout) => {
        const resetIn = formatResetIn(lockout.resetAt, nowMs);
        return resetIn ? [{ lockout, resetIn }] : [];
    });
}

function LockoutRowItem({ lockout, resetIn }: LockoutRow) {
    const cleared = lockout.killed >= lockout.total;
    return (
        <li data-lockout-row className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
            <span className="text-sm text-foreground break-words min-w-0">{lockout.name}</span>
            {lockout.difficulty && <span className="text-xs text-muted">{lockout.difficulty}</span>}
            <span className={`text-xs font-mono ${cleared ? 'text-success' : 'text-muted'}`}>
                {lockout.killed}/{lockout.total}<span className="sr-only"> bosses killed</span>
            </span>
            <span className="text-xs text-muted ml-auto">{resetIn}</span>
        </li>
    );
}

/** The Saved instances card; chrome matches the Quests and Talents sections. */
export function CharacterLockoutsSection({ lockouts }: { lockouts: CharacterLockoutsDto | undefined }) {
    if (!lockouts) return null;
    const rows = activeRows(lockouts.instances, Date.now());
    if (rows.length === 0) return null;
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Saved instances</h2>
            <p className="-mt-3 mb-4 text-xs text-muted">{formatAddonSourceLine(lockouts.syncedAt)}</p>
            <ul className="space-y-2">
                {rows.map((row) => (
                    <LockoutRowItem key={`${row.lockout.instanceId}-${row.lockout.difficultyId}`} {...row} />
                ))}
            </ul>
        </div>
    );
}
