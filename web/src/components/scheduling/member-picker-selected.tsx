/**
 * ROK-2256 — the member picker's "Selected" block. The list below it shows
 * only page 1 (or a search), so a pre-selected member who is not on it would
 * otherwise be counted but invisible. Every selected id gets a §4.3
 * `RemovableChip` here, named by `useMemberNames` (member-picker-names.ts).
 */
import type { JSX } from 'react';
import { RemovableChip } from '../ui/removable-chip';
import { fallbackMemberName } from './member-picker-names';

/** The removable chips for every selected member; nothing when none are picked. */
export function SelectedMembers({ ids, names, onRemove }: {
  ids: readonly number[];
  names: ReadonlyMap<number, string>;
  onRemove: (id: number) => void;
}): JSX.Element | null {
  if (ids.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2" data-testid="selected-members" aria-label="Selected members" role="group">
      {ids.map((id) => {
        const name = names.get(id) ?? fallbackMemberName(id);
        return (
          <RemovableChip key={id} label={name} removeLabel={`Remove ${name}`}
            onRemove={() => onRemove(id)} testId={`selected-member-${id}`} />
        );
      })}
    </div>
  );
}
