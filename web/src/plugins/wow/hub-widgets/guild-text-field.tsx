/**
 * ROK-2136 — one in-game text field in the editor: a `Field`-wrapped
 * `Textarea` capped at the in-game box length with the shared counter
 * (`showCount`), a `text-warning` line per character the game may not show
 * (never blocking), and a field error for control characters the server rejects.
 */
import type { JSX } from 'react';
import {
    WOW_GUILD_INFO_MAX,
    WOW_GUILD_MOTD_MAX,
    findIngameTextWarnings,
    hasIngameControlChars,
    type IngameTextFieldKey,
} from '@raid-ledger/contract';
import { Field } from '../../../components/ui/field';
import { Textarea } from '../../../components/ui/textarea';
import { CONTROL_CHAR_COPY, FIELD_LABELS, WARNING_COPY } from './guild-text.helpers';

const MAX: Record<IngameTextFieldKey, number> = { motd: WOW_GUILD_MOTD_MAX, info: WOW_GUILD_INFO_MAX };
const ROWS: Record<IngameTextFieldKey, number> = { motd: 3, info: 6 };

interface GuildTextFieldProps {
    field: IngameTextFieldKey;
    value: string;
    onChange: (value: string) => void;
}

export function GuildTextField({ field, value, onChange }: GuildTextFieldProps): JSX.Element {
    const warnings = findIngameTextWarnings(value, field);
    const invalid = hasIngameControlChars(value);
    return (
        <div data-testid={`guild-text-field-${field}`}>
            <Field label={FIELD_LABELS[field]} error={invalid ? CONTROL_CHAR_COPY : undefined}>
                <Textarea data-testid={`guild-text-input-${field}`} value={value} rows={ROWS[field]}
                    maxLength={MAX[field]} showCount onChange={(e) => onChange(e.target.value)} />
            </Field>
            {warnings.length > 0 && (
                <ul data-testid={`guild-text-warnings-${field}`} className="mt-1 space-y-0.5 text-xs text-warning">
                    {warnings.map((w) => <li key={w} data-warning={w}>{WARNING_COPY[w]}</li>)}
                </ul>
            )}
        </div>
    );
}
