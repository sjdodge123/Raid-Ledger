/**
 * ROK-1874: §4.7 `warning` status banner on the create form opened from
 * "Lock this time" — the slot's yes-voters overflow the roster, so some will
 * be benched. Not dismissible: it goes away when the numbers stop
 * overflowing.
 *
 * ROK-2025: it names who is benched. A fieldset of inventory `Checkbox` rows
 * lists every yes-voter (vote order) with the latest marked by default; the
 * organizer changes the marks, and a wrong count shows inline and blocks the
 * submit (`guardBenchPick`). Controlled: the form owns the `useBenchPick` state.
 */
import { Checkbox } from '../ui/checkbox';
import { BENCH_PICKER_ID, benchPickError, type BenchPick } from './use-bench-pick';
import type { BenchCandidate } from './use-scheduling-overflow';

export function SchedulingOverflowNotice({ bench }: { bench: BenchPick }) {
    const { overflow } = bench;
    if (!overflow) return null;
    const { rostered, cap, benched, people, creatorVoted } = overflow;
    return (
        <div role="status" data-testid="scheduling-overflow-notice"
            className="rounded-lg border border-warning/30 bg-warning/10 p-4 space-y-2">
            <p className="text-warning font-semibold">More yes-votes than roster spots</p>
            <p className="text-foreground">
                {`${rostered} people will be signed up for this time, but the roster has ${cap} ${cap === 1 ? 'spot' : 'spots'} — ${benched} will go to the bench.`}
            </p>
            {!creatorVoted && (
                <p className="text-foreground">That count includes you — the organizer is always signed up.</p>
            )}
            {people.length > 0 && <BenchPicker people={people} bench={bench} />}
            <p className="text-secondary">
                Or raise the player count, or ask voters to change their vote, before you create the event.
            </p>
        </div>
    );
}

function BenchPicker({ people, bench }: { people: BenchCandidate[]; bench: BenchPick }) {
    const { picked, need, mismatch, toggle } = bench;
    const error = benchPickError(mismatch, need);
    return (
        <fieldset id={BENCH_PICKER_ID} data-testid="scheduling-bench-picker" className="min-w-0 break-words space-y-1">
            <legend className="text-foreground font-semibold">Who goes to the bench</legend>
            <p className="text-secondary">The latest yes-votes are marked. Earlier voters keep their spot. Change it if you like.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {people.map((p) => (
                    <Checkbox key={p.userId} label={p.displayName} checked={picked.includes(p.userId)}
                        onChange={() => toggle(p.userId)} data-testid={`bench-pick-${p.userId}`} />
                ))}
            </div>
            <p className="text-secondary" data-testid="bench-pick-count">{`${picked.length} of ${need} picked`}</p>
            {error !== undefined && <p role="alert" className="text-danger" data-testid="bench-pick-error">{error}</p>}
        </fieldset>
    );
}
