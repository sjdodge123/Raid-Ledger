/**
 * ROK-1787 (S3 of ROK-1781) — `event-create:guild-field`: lets a guild editor
 * show the event on one of their guild pages. Lists only guilds of the chosen
 * game that the viewer can edit; renders nothing when there are none (plain
 * members and non-WoW games never see it). The server re-checks edit rights.
 *
 * ROK-1817: on create (`dropUnlisted`), a preselected guild the viewer cannot
 * edit (a crafted `?guildId=` link) is cleared once the list settles — the
 * picker could never show it, so it would ride along unseen and 403 on submit.
 * Edit mode keeps an unchanged tag (`guildIdForSubmit` omits it).
 */
import { useEffect, type ChangeEvent, type JSX } from 'react';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { useGameGuildsQuery } from './guild-queries';

interface EventCreateGuildFieldProps {
    gameId: number | null;
    guildId: number | null;
    onGuildChange: (guildId: number | null) => void;
    /** Create mode: clear a `guildId` that is not one of the viewer's editable guilds. */
    dropUnlisted?: boolean;
}

export function EventCreateGuildField({ gameId, guildId, onGuildChange, dropUnlisted = false }: EventCreateGuildFieldProps): JSX.Element | null {
    const q = useGameGuildsQuery(gameId ?? undefined);
    const guilds = (q.data?.guilds ?? []).filter((g) => g.canEdit);
    const settled = q.isSuccess || q.isError;
    const unseen = dropUnlisted && settled && guildId !== null && !guilds.some((g) => g.id === guildId);
    useEffect(() => {
        if (unseen) onGuildChange(null);
    }, [unseen, onGuildChange]);
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
