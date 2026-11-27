/**
 * ROK-2352 §4.1 — the WoW `RaiseHandFields`: roles (required, pre-filled from
 * the last hand), an optional character (pre-filled the same way) and, on the whole-game page, the instances to raise a hand
 * in. Reports `{ groupKeys, handDetail, ready }` to core on every change.
 */
import { useEffect, useState, type JSX } from 'react';
import type { WowLfgRole } from '@raid-ledger/contract';
import type { LfgRaiseHandFieldsProps } from '../../lfg-grouping';
import { useLfgGameGroups } from '../../../hooks/use-lfg-game-groups';
import { useWowLfgLastDetail } from './use-wow-lfg-last-detail';
import { WowLfgRolePicker } from './wow-lfg-role-picker';
import { WowLfgInstancePicker } from './wow-lfg-instance-picker';
import { wowLfgPickBlocked } from './wow-lfg-pick-cap';
import { WowLfgCharacterSelect } from './wow-lfg-character-select';
import { useWowLfgCharacterPick } from './use-wow-lfg-character-pick';

/** Roles state seeded once from the last hand detail. */
function useSeededRoles(gameId: number): [WowLfgRole[], (r: WowLfgRole[]) => void] {
    const last = useWowLfgLastDetail(gameId);
    const [roles, setRoles] = useState<WowLfgRole[] | null>(null);
    const seeded = last.data?.roles ?? [];
    return [roles ?? seeded, setRoles];
}

/** Fields shown after the urgency pick, before the WoW hand is raised. */
export function WowLfgRaiseHandFields({ context, onChange }: LfgRaiseHandFieldsProps): JSX.Element {
    const onWholeGame = context.groupKey === '';
    const groups = useLfgGameGroups(context.gameId, onWholeGame);
    const [roles, setRoles] = useSeededRoles(context.gameId);
    const character = useWowLfgCharacterPick(context.gameId, context.gameSlug);
    const { characterId } = character;
    const [picked, setPicked] = useState<string[]>([]);
    const rolesKey = roles.join(',');
    const pickedKey = picked.join('|');
    // At the cap a submit would only earn the 400 toast: hold it back.
    const blocked = onWholeGame && wowLfgPickBlocked(groups.data?.groups ?? [], picked);
    useEffect(() => {
        const handDetail = { roles, ...(characterId ? { characterId } : {}) };
        onChange({ groupKeys: picked, handDetail, ready: roles.length > 0 && !blocked });
        // Keyed on the joined values so a fresh array with the same picks does not re-fire.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rolesKey, pickedKey, characterId, blocked, onChange]);
    return (
        <div data-testid="wow-lfg-raise-hand" className="w-full space-y-3 rounded-lg border border-edge bg-panel p-3">
            <WowLfgRolePicker roles={roles} onChange={setRoles} />
            <WowLfgCharacterSelect {...character} />
            {onWholeGame && (
                <WowLfgInstancePicker groups={groups.data?.groups ?? []} picked={picked} onChange={setPicked} />
            )}
        </div>
    );
}
