/**
 * ROK-1960 L3 — the upload sheet's state: pick → parsed preview → result, the
 * one inline banner, the picked campaign and the thumbnail's object URL
 * (revoked when the save changes and when the sheet unmounts).
 */
import { useEffect, useState } from 'react';
import { parseBg3Save, selectBg3SaveSource } from './bg3-parse-save';
import { Bg3ParseError, bg3ParseErrorMessage } from './bg3-parse-errors';
import { bg3UploadErrorMessage } from './bg3-upload-errors';
import { useBg3UploadSave, type Bg3UploadResult } from './use-bg3-upload-save';
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

function parseMessage(error: unknown): string {
    return bg3ParseErrorMessage(error instanceof Bg3ParseError ? error : new Bg3ParseError('reader_failed'));
}

export function useBg3UploadFlow(hubId: number, initialCampaignId: number | null) {
    const upload = useBg3UploadSave(hubId);
    const [parsed, setParsed] = useState<Parsed | null>(null);
    const [parsing, setParsing] = useState(false);
    const [banner, setBanner] = useState<Bg3UploadBannerState | null>(null);
    const [result, setResult] = useState<Bg3UploadResult | null>(null);
    const [picked, setPicked] = useState<number | null | undefined>(undefined);
    const thumbUrl = parsed?.thumbUrl ?? null;
    useEffect(() => () => { if (thumbUrl !== null) URL.revokeObjectURL(thumbUrl); }, [thumbUrl]);
    const campaignId = picked === undefined ? initialCampaignId : picked;

    const read = (dropped: Bg3DroppedFiles): void => {
        setBanner(null);
        setParsing(true);
        readSave(dropped)
            .then(setParsed, (e: unknown) => setBanner({ tone: 'danger', text: parseMessage(e) }))
            .finally(() => setParsing(false));
    };
    const submit = (defaultCampaignId: number | null): void => {
        if (parsed === null || campaignId === null) return;
        setBanner(null);
        upload.mutate({ save: parsed.save, campaignId, defaultCampaignId }, {
            onSuccess: setResult,
            onError: (e) => setBanner({ tone: 'danger', text: bg3UploadErrorMessage(e) }),
        });
    };
    return {
        parsed, parsing, banner, result, campaignId, read, submit,
        uploading: upload.isPending, setCampaignId: setPicked,
    };
}
