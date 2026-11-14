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
 * Edit mode keeps an unchanged tag (`guildIdForSubmit` omits it) and shows the
 * hub the form opened with as a {@link UNLISTED_HUB_LABEL} option, so the picker
 * does not read "None" for an event that is in fact tagged (the DTO carries no
 * hub name). It stays offered after a switch away, so the viewer can switch back
 * (re-picking it is an unchanged tag, omitted from the save) — but only while the
 * form's game is still the one it opened with: that hub belongs to that game, and
 * sending it with another game is a 400 `GUILD_GAME_MISMATCH` (Codex P2).
 */
import { useEffect, useState, type ChangeEvent, type JSX } from 'react';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { useTaggableHubsQuery } from './taggable-hubs-queries';

/** Label of the option standing in for the tagged hub the viewer cannot list (edit mode). */
export const UNLISTED_HUB_LABEL = 'Current hub (not in your list)';

interface EventHubFieldProps {
    gameId: number | null;
    guildId: number | null;
    onGuildChange: (guildId: number | null) => void;
    /** Create mode: clear a `guildId` that is not one of the viewer's taggable hubs. */
    dropUnlisted?: boolean;
}

export function EventHubField({ gameId, guildId, onGuildChange, dropUnlisted = false }: EventHubFieldProps): JSX.Element | null {
    const q = useTaggableHubsQuery(gameId ?? undefined);
    const [opened] = useState({ guildId, gameId });
    const hubs = q.data?.hubs ?? [];
    // Only a successful lookup can prove a hub is absent; a loading or failed one keeps the pick (Codex P2).
    const isAbsent = (id: number | null): id is number => q.isSuccess && id !== null && !hubs.some((h) => h.id === id);
    const unseen = dropUnlisted && isAbsent(guildId);
    const sameGame = gameId === opened.gameId;
    const standIn = !dropUnlisted && sameGame && isAbsent(opened.guildId) ? opened.guildId : null;
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
                    {standIn !== null && <option value={String(standIn)}>{UNLISTED_HUB_LABEL}</option>}
                    {hubs.map((h) => <option key={h.id} value={String(h.id)}>{h.name}</option>)}
                </Select>
            </Field>
        </div>
    );
}
