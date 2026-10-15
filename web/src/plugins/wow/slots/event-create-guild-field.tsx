/**
 * ROK-1787 (S3 of ROK-1781) — `event-create:guild-field`: lets a guild editor
 * show the event on one of their guild pages. Lists only guilds of the chosen
 * game that the viewer can edit; renders nothing when there are none (plain
 * members and non-WoW games never see it). The server re-checks edit rights.
 */
import type { ChangeEvent, JSX } from 'react';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { useGameGuilds } from './guild-queries';

interface EventCreateGuildFieldProps {
    gameId: number | null;
    guildId: number | null;
    onGuildChange: (guildId: number | null) => void;
}

export function EventCreateGuildField({ gameId, guildId, onGuildChange }: EventCreateGuildFieldProps): JSX.Element | null {
    const guilds = useGameGuilds(gameId ?? undefined).filter((g) => g.canEdit);
    if (guilds.length === 0) return null;
    const onChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        const next = Number(e.target.value);
        onGuildChange(e.target.value === '' || !Number.isInteger(next) ? null : next);
    };
    return (
        <div className="mt-4" data-testid="event-guild-field">
            <Field label="Guild" hint="Shows this event on the guild page">
                <Select value={guildId === null ? '' : String(guildId)} onChange={onChange} placeholder="None">
                    {guilds.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                </Select>
            </Field>
        </div>
    );
}
