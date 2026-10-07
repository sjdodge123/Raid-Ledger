/**
 * After a create-mode import lands (ROK-1738 D10): no result step — close
 * Add Character (the slot's `onClose`, unguarded: the import supersedes the
 * form), toast the headline, and land on the character page. Used for both
 * a `create` and an `update` target. The apply mutation already refreshed
 * the character lists (`useAddonImportNewApply`).
 */
import { useNavigate } from 'react-router-dom';
import type { AddonImportNewResultDto } from '@raid-ledger/contract';
import { toast } from '../../../../lib/toast';
import { resultHeadline } from './addon-import.helpers';

export function useImportCreated(onClose: () => void): (result: AddonImportNewResultDto) => void {
    const navigate = useNavigate();
    return (result) => {
        onClose();
        toast.success(resultHeadline(result));
        const id = result.target.characterId;
        if (id) navigate(`/characters/${encodeURIComponent(id)}`);
    };
}
