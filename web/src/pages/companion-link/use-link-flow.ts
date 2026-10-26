/**
 * ROK-1955 — state for the `/link` page: the typed / pre-filled code, the
 * preview and decision mutations, and a ticking clock for the expiry line.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CompanionUserCodeSchema, normaliseCompanionUserCode } from '@raid-ledger/contract';
import { useCompanionLinkDecision, useCompanionLinkPreview } from '../../hooks/use-companion-link';
import { readPrefilledCode } from './companion-link-code';
import type { LinkDecision } from './link-review-card';

const INVALID_CODE = "That code isn't valid — check the 8 letters on your computer.";

/** `Date.now()`, re-read every `intervalMs` so the expiry line moves. */
export function useNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(id);
    }, [intervalMs]);
    return now;
}

/**
 * Read the deep-linked code once, then drop it from the address bar (and
 * so from history). A pre-filled code is previewed straight away — preview
 * has no side effect; approving still needs the explicit click.
 */
function usePrefill(onCode: (code: string) => void): string {
    const location = useLocation();
    const navigate = useNavigate();
    const [initial] = useState(() => readPrefilledCode(location.hash, location.search) ?? '');
    const done = useRef(false);
    useEffect(() => {
        if (done.current || initial === '') return;
        done.current = true;
        navigate({ pathname: location.pathname }, { replace: true });
        onCode(initial);
    }, [initial, location.pathname, navigate, onCode]);
    return initial;
}

/** Everything the page renders from. */
export function useLinkFlow() {
    const preview = useCompanionLinkPreview();
    const decision = useCompanionLinkDecision();
    const [localError, setLocalError] = useState<string | undefined>(undefined);
    const previewCode = preview.mutate;
    const submitCode = useCallback((raw: string): void => {
        const parsed = CompanionUserCodeSchema.safeParse(raw);
        if (!parsed.success) { setLocalError(INVALID_CODE); return; }
        setLocalError(undefined);
        previewCode(parsed.data);
    }, [previewCode]);
    const [code, setCode] = useState(usePrefill(submitCode));
    const changeCode = (next: string): void => { setCode(next); setLocalError(undefined); preview.reset(); };
    const decide = (choice: LinkDecision, name?: string): void => {
        const userCode = normaliseCompanionUserCode(preview.data?.userCode ?? code);
        decision.mutate({ userCode, decision: choice, ...(name === undefined ? {} : { name }) });
    };
    return { preview, decision, code, localError, changeCode, submit: () => submitCode(code), decide };
}
