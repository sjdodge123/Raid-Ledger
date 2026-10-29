/**
 * ROK-2027 D9 — while the Gallery is scoped to a plugin-resolved subject (one
 * Valheim Deaths bar), this ONE removable chip replaces the All · Deaths ·
 * Screenshots chips: "<Name>'s deaths" with a 44px "Remove <Name>'s deaths"
 * button. Removing it returns the dialog to every death. Shared §4.3
 * `RemovableChip` — tokens only.
 */
import type { JSX } from 'react';
import { RemovableChip } from '../../ui/removable-chip';

export interface HubGallerySubjectChipProps {
    /** The person's display name (`HubGalleryOpenRequest.subject.label`). */
    label: string;
    onClear: () => void;
}

export function HubGallerySubjectChip({ label, onClear }: HubGallerySubjectChipProps): JSX.Element {
    return (
        <div role="group" aria-label="Show pictures" className="flex flex-wrap gap-2">
            <RemovableChip label={`${label}'s deaths`} removeLabel={`Remove ${label}'s deaths`} onRemove={onClear}
                testId="hub-gallery-subject-chip" />
        </div>
    );
}
