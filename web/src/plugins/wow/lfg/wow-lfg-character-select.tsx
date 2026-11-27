/**
 * ROK-2352 §4.1 — the optional character pick on a WoW hand: the shared
 * `Select` in a `Field`, "No character" first. Hidden when the caller has no
 * character on the game that fits it.
 */
import type { JSX } from 'react';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { WOW_LFG_COPY } from './wow-lfg-copy';
import type { WowLfgCharacterPick } from './use-wow-lfg-character-pick';

export function WowLfgCharacterSelect({ options, characterId, setCharacterId }: WowLfgCharacterPick): JSX.Element | null {
    if (options.length === 0) return null;
    return (
        <Field label={WOW_LFG_COPY.characterLabel}>
            <Select data-testid="wow-lfg-character" fieldSize="sm" value={characterId ?? ''}
                onChange={(e) => setCharacterId(e.currentTarget.value === '' ? null : e.currentTarget.value)}>
                <option value="">{WOW_LFG_COPY.noCharacter}</option>
                {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
        </Field>
    );
}
