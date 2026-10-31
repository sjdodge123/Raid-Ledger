/**
 * ROK-1960 operator ruling (2026-10-31) — before Upload binds the key, read
 * where the caller's saves with it sit now. Unbound / same hub → `proceed()`
 * at once; another hub → hold `confirm` until the user picks Move here or
 * Cancel. A failed read posts nothing and surfaces as the sheet's banner.
 */
import { useRef, useState } from 'react';
import type { Bg3CampaignKeyBinding } from '@raid-ledger/contract';
import { fetchBg3KeyBinding } from '../api/bg3-api';
import { toBg3UploadError, type Bg3UploadError } from './bg3-upload-errors';
import { isBg3CrossHubBinding } from './bg3-upload-format';

export function useBg3MoveCheck(hubId: number, isOpen: () => boolean, onError: (e: Bg3UploadError) => void) {
    const [confirm, setConfirm] = useState<Bg3CampaignKeyBinding | null>(null);
    const [checking, setChecking] = useState(false);
    const pending = useRef<(() => void) | null>(null);
    const check = (campaignKey: string, proceed: () => void): void => {
        setChecking(true);
        fetchBg3KeyBinding(campaignKey)
            .then(({ binding }) => {
                if (!isOpen()) return;
                if (!isBg3CrossHubBinding(binding, hubId)) return proceed();
                pending.current = proceed;
                setConfirm(binding);
            }, (e: unknown) => { if (isOpen()) onError(toBg3UploadError(e)); })
            .finally(() => { if (isOpen()) setChecking(false); });
    };
    const cancel = (): void => { pending.current = null; setConfirm(null); };
    /** Move here: run the held upload (bind, then post). */
    const confirmMove = (): void => { const go = pending.current; cancel(); go?.(); };
    return { confirm, checking, check, cancel, confirmMove };
}
