/**
 * ROK-1767 (L3): "Link game" — pick a game, a role ("Create @<game>" or an
 * existing guild role) and the inactivity window. Preflight problems show as
 * a §4.7 danger banner and keep Save disabled. Modal at ≥1024px, BottomSheet
 * below (§4.4), with a dirty-close guard.
 */
import { useState, type JSX } from 'react';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { GAME_ROLE_DEFAULT_WINDOW_DAYS } from '@raid-ledger/contract';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { GameSearchInput } from '../../components/events/game-search-input';
import { useMediaQuery } from '../../hooks/use-media-query';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { toast } from '../../lib/toast';
import { useDiscordRoleOptions, useGameRolePreflight, useGameRoles } from '../../hooks/admin/use-game-roles';

/** Select value for "let the bot create the role". */
export const CREATE_ROLE = '__create__';
const DEFAULT_WINDOW = String(GAME_ROLE_DEFAULT_WINDOW_DAYS);

function parseWindow(text: string): number | null {
    const n = Number(text);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

function useLinkForm(isOpen: boolean, onClose: () => void) {
    const { upsert } = useGameRoles();
    const roles = useDiscordRoleOptions(isOpen);
    const [game, setGame] = useState<IgdbGameDto | null>(null);
    const [roleChoice, setRoleChoice] = useState(CREATE_ROLE);
    const [windowText, setWindowText] = useState(DEFAULT_WINDOW);
    const roleId = roleChoice === CREATE_ROLE ? null : roleChoice;
    const preflight = useGameRolePreflight(isOpen && game ? { gameId: game.id, roleId } : null);
    const windowDays = parseWindow(windowText);
    const dirty = game !== null || roleChoice !== CREATE_ROLE || windowText !== DEFAULT_WINDOW;
    const problems = preflight.data?.ok === false ? preflight.data.problems.map((p) => p.message) : [];
    const canSave = !!game && windowDays !== null && preflight.data?.ok === true && !upsert.isPending;
    const save = () => {
        if (!game || windowDays === null) return;
        upsert.mutate({ gameId: game.id, body: { roleId, windowDays } }, {
            onSuccess: () => { toast.success(`${game.name} linked to a Discord role`); onClose(); },
        });
    };
    return { game, setGame, roleChoice, setRoleChoice, windowText, setWindowText, windowDays, roles: roles.data ?? [],
        problems, saveError: upsert.error?.message ?? null, canSave, save, dirty, saving: upsert.isPending };
}
type LinkForm = ReturnType<typeof useLinkForm>;

function ProblemBanner({ problems }: { problems: string[] }): JSX.Element | null {
    if (problems.length === 0) return null;
    return (
        <div role="alert" data-testid="game-role-preflight-banner"
            className="p-3 rounded-lg border bg-danger/10 border-danger/30 text-danger text-sm">
            {problems.length === 1 ? problems[0] : (
                <ul className="list-disc pl-5 space-y-1">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
        </div>
    );
}

function LinkFields({ form }: { form: LinkForm }): JSX.Element {
    const createLabel = `Create @${form.game?.name ?? 'game'}`;
    return (
        <div className="space-y-4">
            <GameSearchInput id="game-role-game" value={form.game} onChange={form.setGame} />
            <Field label="Discord role" hint="Pick an existing role, or let the bot create one named after the game.">
                <Select value={form.roleChoice} onChange={(e) => form.setRoleChoice(e.target.value)}>
                    <option value={CREATE_ROLE}>{createLabel}</option>
                    {form.roles.map((r) => (
                        <option key={r.id} value={r.id} disabled={!r.assignable}>
                            @{r.name}{r.assignable ? '' : ' (above the bot)'}
                        </option>
                    ))}
                </Select>
            </Field>
            <Field label="Inactivity window (days)" hint="Members who haven't played for this long lose the role."
                error={form.windowDays === null ? 'Enter a whole number from 1 to 365.' : undefined}>
                <Input type="number" inputMode="numeric" min={1} max={365} value={form.windowText}
                    onChange={(e) => form.setWindowText(e.target.value)} />
            </Field>
            <ProblemBanner problems={form.saveError ? [...form.problems, form.saveError] : form.problems} />
        </div>
    );
}

/** The link dialog; its parent keys it so every open starts clean. */
export function GameRoleLinkDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const form = useLinkForm(isOpen, onClose);
    const guard = useDirtyCloseGuard(form.dirty, onClose);
    const footer = (
        <>
            <Button variant="secondary" onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" disabled={!form.canSave} onClick={form.save} data-testid="game-role-save">
                {form.saving ? 'Saving…' : 'Save'}
            </Button>
        </>
    );
    const shared = { isOpen, onClose, closeGuard: guard, discardMessage: 'Discard this game role link?', title: 'Link game to a role', footer };
    const body = <LinkFields form={form} />;
    if (isDesktop) return <Modal {...shared} maxWidth="max-w-lg">{body}</Modal>;
    return <BottomSheet {...shared}>{body}</BottomSheet>;
}
