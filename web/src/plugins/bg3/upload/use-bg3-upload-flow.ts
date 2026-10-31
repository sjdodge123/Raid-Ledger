/**
 * ROK-1960 L3 — the upload sheet's state: pick → parsed preview → result, the
 * one inline banner, the picked campaign and the thumbnail's object URL
 * (revoked when the save changes and when the sheet unmounts). Unmounting
 * terminates the parse worker; a parse that settles after the sheet closed
 * is dropped, and its object URL revoked at once.
 */
import { useEffect, useRef, useState } from 'react';
import { disposeBg3ParseWorker } from './bg3-parse-client';
import { parseBg3Save, selectBg3SaveSource } from './bg3-parse-save';
import { Bg3ParseError, bg3ParseErrorMessage } from './bg3-parse-errors';
import { bg3UploadErrorMessage, type Bg3UploadError } from './bg3-upload-errors';
import { useBg3UploadSave, type Bg3UploadResult, type Bg3UploadVars } from './use-bg3-upload-save';
import { useBg3MoveCheck } from './use-bg3-move-check';
import type { Bg3ParsedSave } from './bg3-upload-api';
import type { Bg3DroppedFiles } from './bg3-drop-files';
import type { Bg3UploadBannerTone } from './bg3-upload-banner';

export interface Bg3UploadBannerState {
    readonly tone: Bg3UploadBannerTone;
    readonly text: string;
}

interface Parsed {
    readonly save: Bg3ParsedSave;
    readonly thumbUrl: string | null;
}

function thumbUrlOf(save: Bg3ParsedSave): string | null {
    return save.webp === null ? null : URL.createObjectURL(new Blob([save.webp], { type: 'image/webp' }));
}

async function readSave(dropped: Bg3DroppedFiles): Promise<Parsed> {
    const save = await parseBg3Save(selectBg3SaveSource(dropped.files, dropped.folderName));
    return { save, thumbUrl: thumbUrlOf(save) };
}

/** A read that settled after the sheet closed: nothing will render it, so free its object URL now. */
function drop(late: Parsed): void {
    if (late.thumbUrl !== null) URL.revokeObjectURL(late.thumbUrl);
}

/** `true` while the sheet is mounted; unmounting also kills the parse worker. */
function useMountedFlag(): () => boolean {
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            disposeBg3ParseWorker();
        };
    }, []);
    return () => mounted.current;
}

/** Revoke the thumbnail's object URL when the save changes and when the sheet unmounts. */
function useRevokeOnChange(thumbUrl: string | null): void {
    useEffect(() => () => { if (thumbUrl !== null) URL.revokeObjectURL(thumbUrl); }, [thumbUrl]);
}

function parseMessage(error: unknown): string {
    return bg3ParseErrorMessage(error instanceof Bg3ParseError ? error : new Bg3ParseError('reader_failed'));
}

/** Bind → blob → message; a 409 `cross_hub_move` holds the upload for Move here (re-bind with the flag) / Cancel. */
function useGuardedUpload(hubId: number, onResult: (r: Bg3UploadResult) => void, fail: (e: Bg3UploadError) => void) {
    const upload = useBg3UploadSave(hubId);
    const move = useBg3MoveCheck();
    const run = (vars: Bg3UploadVars): void => upload.mutate(vars, {
        onSuccess: onResult,
        onError: (e) => {
            if (e.move === null) return fail(e);
            move.hold(e.move, () => run({ ...vars, confirmCrossHub: true }));
        },
    });
    return { upload, move, run };
}

export function useBg3UploadFlow(hubId: number, initialCampaignId: number | null) {
    const isOpen = useMountedFlag();
    const [parsed, setParsed] = useState<Parsed | null>(null);
    const [parsing, setParsing] = useState(false);
    const [banner, setBanner] = useState<Bg3UploadBannerState | null>(null);
    const [result, setResult] = useState<Bg3UploadResult | null>(null);
    const [picked, setPicked] = useState<number | null | undefined>(undefined);
    useRevokeOnChange(parsed?.thumbUrl ?? null);
    const campaignId = picked === undefined ? initialCampaignId : picked;
    const fail = (e: Bg3UploadError): void => setBanner({ tone: 'danger', text: bg3UploadErrorMessage(e) });
    const { upload, move, run } = useGuardedUpload(hubId, setResult, fail);

    const read = (dropped: Bg3DroppedFiles): void => {
        setBanner(null);
        setParsing(true);
        readSave(dropped)
            .then((next) => { if (isOpen()) setParsed(next); else drop(next); },
                (e: unknown) => { if (isOpen()) setBanner({ tone: 'danger', text: parseMessage(e) }); })
            .finally(() => { if (isOpen()) setParsing(false); });
    };
    const submit = (): void => {
        if (parsed === null || campaignId === null) return;
        setBanner(null);
        run({ save: parsed.save, campaignId });
    };
    return {
        parsed, parsing, banner, result, campaignId, read, submit, setCampaignId: setPicked,
        confirm: move.confirm, moveHere: move.confirmMove, cancelMove: move.cancel, uploading: upload.isPending,
    };
}
