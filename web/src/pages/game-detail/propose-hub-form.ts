/**
 * ROK-1870 — state + validation for the "Start a community hub" form. The
 * name runs through the contract's `HubNameSchema` before any request; server
 * refusals land on the name field (409 name clash) or in the form banner
 * (pending-for-game, limit, not-in-discord, 429).
 */
import { useState } from 'react';
import { HUB_BLURB_MAX, HUB_NAME_MAX, HUB_NAME_MIN, HubNameSchema } from '@raid-ledger/contract';
import { httpStatusOf } from '../../lib/api/api-error';
import { useProposeHub } from './use-game-hubs';

export interface ProposalErrors { name?: string | undefined; blurb?: string | undefined; banner?: string | undefined }

/** Client-side check; empty object when the form may submit. */
export function validateProposal(name: string, blurb: string): ProposalErrors {
    const errors: ProposalErrors = {};
    const trimmed = name.trim();
    if (trimmed.length < HUB_NAME_MIN || trimmed.length > HUB_NAME_MAX) {
        errors.name = `Hub name must be ${HUB_NAME_MIN}–${HUB_NAME_MAX} characters.`;
    } else {
        const parsed = HubNameSchema.safeParse(trimmed);
        if (!parsed.success) errors.name = parsed.error.issues[0]?.message ?? 'Choose another name.';
    }
    if (blurb.trim().length === 0) errors.blurb = 'Add a short description.';
    else if (blurb.trim().length > HUB_BLURB_MAX) errors.blurb = `Keep it under ${HUB_BLURB_MAX} characters.`;
    return errors;
}

/** Route a server refusal to the field it belongs to. */
export function mapProposalError(err: Error): ProposalErrors {
    const status = httpStatusOf(err);
    if (status === 409 && /name already exists/i.test(err.message)) return { name: err.message };
    if (status === 429) return { banner: 'Too many proposals right now — try again in an hour.' };
    return { banner: err.message };
}

export interface ProposalForm {
    name: string;
    blurb: string;
    errors: ProposalErrors;
    isPending: boolean;
    setName: (v: string) => void;
    setBlurb: (v: string) => void;
    submit: () => void;
    reset: () => void;
}

/** Form state for one game's proposal; closes via `onDone` on success. */
export function useProposalForm(gameId: number, onDone: () => void): ProposalForm {
    const [name, setName] = useState('');
    const [blurb, setBlurb] = useState('');
    const [errors, setErrors] = useState<ProposalErrors>({});
    const mutation = useProposeHub(gameId);
    const reset = (): void => { setName(''); setBlurb(''); setErrors({}); };
    const submit = (): void => {
        const found = validateProposal(name, blurb);
        setErrors(found);
        if (found.name || found.blurb) return;
        mutation.mutate({ gameId, name: name.trim(), blurb: blurb.trim() }, {
            onSuccess: () => { reset(); onDone(); },
            onError: (err) => setErrors(mapProposalError(err)),
        });
    };
    return { name, blurb, errors, isPending: mutation.isPending, setName, setBlurb, submit, reset };
}
