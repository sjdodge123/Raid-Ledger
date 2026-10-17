/**
 * State + transitions of the addon import dialog (ROK-1724 §4.4, ROK-1738).
 *
 * Two modes, fixed for a dialog instance (the owner keys it per session):
 * - `character`: the ROK-1724 per-character route — paste → preview → result.
 * - `create`: Add Character's id-less route — paste → preview (with the
 *   resolved create/update `target`) → `onCreated` (D10: no result step; the
 *   owner closes, toasts and navigates).
 *
 * Ruleset pick (D13): when the create target's export carries no ruleset the
 * preview asks for one. The pick is reset on every new preview and is sent as
 * `ruleset` on apply ONLY when `target.ruleset === null`.
 */
import { useEffect, useRef, useState } from 'react';
import type {
    AddonImportNewResultDto,
    AddonImportResultDto,
    AddonImportTargetDto,
    WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { toast } from '../../../../lib/toast';
import { resultHeadline } from './addon-import.helpers';
import {
    useAddonImportApply,
    useAddonImportNewApply,
    useAddonImportNewPreview,
    useAddonImportPreview,
    type AddonImportConfirm,
} from './use-addon-import';

export type AddonImportMode =
    | { mode: 'character'; characterId: string }
    | { mode: 'create'; onCreated: (result: AddonImportNewResultDto) => void };

export type AddonImportStep = 'paste' | 'preview' | 'result';

export interface AddonImportChecked {
    importString: string;
    result: AddonImportResultDto;
    /** The create route's resolved target; null on the per-character route. */
    target: AddonImportTargetDto | null;
}

/** D13: the export has no ruleset and a character is about to be created. */
export function needsRulesetPick(target: AddonImportTargetDto | null | undefined): boolean {
    return target?.action === 'create' && target.ruleset === null;
}

/** Mirrors `isOpen` into a ref so an apply that settles later can tell whether the dialog is still open. */
function useIsOpenRef(isOpen: boolean) {
    const ref = useRef(isOpen);
    useEffect(() => { ref.current = isOpen; }, [isOpen]);
    return ref;
}

/** Both routes' mutations (hooks can't be conditional); only the active mode's pair ever fires. */
function useModeMutations(mode: AddonImportMode) {
    const id = mode.mode === 'character' ? mode.characterId : '';
    const charPreview = useAddonImportPreview(id);
    const charApply = useAddonImportApply(id);
    const newPreview = useAddonImportNewPreview();
    const newApply = useAddonImportNewApply();
    const create = mode.mode === 'create';
    return { charPreview, charApply, newPreview, newApply, preview: create ? newPreview : charPreview, apply: create ? newApply : charApply };
}

function useFlowState() {
    const [text, setText] = useState('');
    const [step, setStep] = useState<AddonImportStep>('paste');
    const [checked, setChecked] = useState<AddonImportChecked | null>(null);
    const [applied, setApplied] = useState<AddonImportResultDto | null>(null);
    const [confirm, setConfirm] = useState<AddonImportConfirm>({});
    const [ruleset, setRuleset] = useState<WowForeverSelectableRuleset | null>(null);
    return { text, setText, step, setStep, checked, setChecked, applied, setApplied, confirm, setConfirm, ruleset, setRuleset };
}

type Mutations = ReturnType<typeof useModeMutations>;
type FlowState = ReturnType<typeof useFlowState>;

function makeCheck(mode: AddonImportMode, m: Mutations, s: FlowState) {
    const onChecked = (importString: string, result: AddonImportResultDto, target: AddonImportTargetDto | null) => {
        m.apply.reset();
        s.setChecked({ importString, result, target });
        s.setConfirm({});
        s.setRuleset(null);
        s.setStep('preview');
    };
    return (importString: string) => {
        if (mode.mode === 'create') {
            m.newPreview.mutate({ importString }, { onSuccess: (r) => onChecked(importString, r, r.target) });
        } else {
            m.charPreview.mutate({ importString }, { onSuccess: (r) => onChecked(importString, r, null) });
        }
    };
}

function makeRunImport(mode: AddonImportMode, m: Mutations, s: FlowState, openRef: { current: boolean }) {
    return () => {
        const c = s.checked;
        if (!c) return;
        if (mode.mode === 'create') {
            const pick = needsRulesetPick(c.target);
            if (pick && !s.ruleset) return;
            const ruleset = pick ? s.ruleset ?? undefined : undefined;
            m.newApply.mutate({ importString: c.importString, confirm: s.confirm, ruleset }, { onSuccess: mode.onCreated });
            return;
        }
        m.charApply.mutate({ importString: c.importString, confirm: s.confirm }, {
            onSuccess: (result) => {
                s.setApplied(result); s.setStep('result');
                if (!openRef.current) toast.success(resultHeadline(result));
            },
        });
    };
}

export function useAddonImportFlow(mode: AddonImportMode, isOpen: boolean) {
    const s = useFlowState();
    const m = useModeMutations(mode);
    const openRef = useIsOpenRef(isOpen);
    const back = () => { m.apply.reset(); s.setStep('paste'); };
    const again = () => {
        s.setText(''); s.setChecked(null); s.setApplied(null); s.setRuleset(null);
        m.preview.reset(); m.apply.reset(); s.setStep('paste');
    };
    return {
        ...s, preview: m.preview, apply: m.apply, back, again,
        check: makeCheck(mode, m, s), runImport: makeRunImport(mode, m, s, openRef),
    };
}

export type AddonImportFlow = ReturnType<typeof useAddonImportFlow>;
