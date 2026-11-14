/**
 * ROK-2071 — `event-create:hub-field`, the Core "Hub" picker on the event
 * form (create AND edit). Lists every hub of the chosen game the viewer may
 * tag the event to — any hub kind, from `GET /guilds/taggable` — and renders
 * nothing when there are none. Core-owned, so it works with the WoW plugin
 * off. Replaces the WoW-only "Guild" field (ROK-1787).
 *
 * ROK-1817: on create (`dropUnlisted`), a preselected hub the viewer cannot
 * tag (a crafted `?guildId=` link) is cleared once the list settles — the
 * picker could never show it, so it would ride along unseen and 403 on submit.
 * Edit mode keeps an unchanged tag (`guildIdForSubmit` omits it) and shows it
 * as a disabled {@link UNLISTED_HUB_LABEL} option, so the picker does not read
 * "None" for an event that is in fact tagged (the DTO carries no hub name).
 */
import { useEffect, type ChangeEvent, type JSX } from 'react';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { useTaggableHubsQuery } from './taggable-hubs-queries';

/** Label of the disabled option standing in for a tagged hub the viewer cannot list. */
export const UNLISTED_HUB_LABEL = "A hub you can't edit";

interface EventHubFieldProps {
    gameId: number | null;
    guildId: number | null;
    onGuildChange: (guildId: number | null) => void;
    /** Create mode: clear a `guildId` that is not one of the viewer's taggable hubs. */
    dropUnlisted?: boolean;
}

export function EventHubField({ gameId, guildId, onGuildChange, dropUnlisted = false }: EventHubFieldProps): JSX.Element | null {
    const q = useTaggableHubsQuery(gameId ?? undefined);
    const hubs = q.data?.hubs ?? [];
    // Only a successful lookup can prove the hub is absent; a failed one keeps the pick (Codex P2).
    const absent = guildId !== null && !hubs.some((h) => h.id === guildId);
    const unseen = dropUnlisted && q.isSuccess && absent;
    useEffect(() => {
        if (unseen) onGuildChange(null);
    }, [unseen, onGuildChange]);
    if (hubs.length === 0) return null;
    const onChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        const next = Number(e.target.value);
        onGuildChange(e.target.value === '' || !Number.isInteger(next) ? null : next);
    };
    return (
        <div className="mt-4" data-testid="event-hub-field">
            <Field label="Hub" hint="Shows this event on the hub page">
                <Select value={guildId === null ? '' : String(guildId)} onChange={onChange} placeholder="None">
                    {!dropUnlisted && absent && <option value={String(guildId)} disabled>{UNLISTED_HUB_LABEL}</option>}
                    {hubs.map((h) => <option key={h.id} value={String(h.id)}>{h.name}</option>)}
                </Select>
            </Field>
        </div>
    );
}
