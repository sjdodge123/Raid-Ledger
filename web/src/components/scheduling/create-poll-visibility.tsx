/**
 * CreatePollVisibility (ROK-1750) — "Who can see this poll?" in the create
 * modal: Community (default, today's behaviour) or Private — anyone with the
 * link. Reuses the inventory `RadioGroup` (list appearance). Hidden for
 * reschedule polls (ruling R3) by the caller.
 */
import type { JSX } from 'react';
import type { StandalonePollVisibility } from '@raid-ledger/contract';
import { RadioGroup, type RadioOption } from '../ui/radio-group';

export const PRIVATE_POLL_HINT =
    'Only people you pick or who open the link can see and vote. Not posted to Discord or listed on the Events page.';

const OPTIONS: readonly RadioOption<StandalonePollVisibility>[] = [
    { value: 'public', label: 'Community', description: 'Everyone in the community can see and vote.' },
    { value: 'private', label: 'Private — anyone with the link', description: PRIVATE_POLL_HINT },
];

export function CreatePollVisibility({ value, onChange }: {
    value: StandalonePollVisibility;
    onChange: (value: StandalonePollVisibility) => void;
}): JSX.Element {
    return (
        <RadioGroup<StandalonePollVisibility>
            label="Who can see this poll?"
            name="poll-visibility"
            options={OPTIONS}
            value={value}
            onChange={onChange}
        />
    );
}
