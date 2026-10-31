/**
 * ROK-1960 operator ruling (2026-10-31) — the cross-hub bind confirm. Binding
 * the key moves every earlier save with it, so a key bound in ANOTHER hub stops
 * the upload here: a §4.7 `warning` banner with Move here / Cancel, inline in
 * the sheet (never a toast). Cancel moves and posts nothing.
 */
import type { JSX } from 'react';
import type { Bg3CampaignKeyBinding } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { BG3_UPLOAD_WARNING_PANEL } from './bg3-upload-banner';
import { bg3MoveConfirmText } from './bg3-upload-format';

interface Props {
    readonly binding: Bg3CampaignKeyBinding;
    readonly onMove: () => void;
    readonly onCancel: () => void;
}

export function Bg3UploadMoveConfirm({ binding, onMove, onCancel }: Props): JSX.Element {
    return (
        <div role="group" aria-label="Move this playthrough here?" data-testid="bg3-upload-move-confirm"
            className={`flex flex-col gap-2 ${BG3_UPLOAD_WARNING_PANEL}`}>
            <p role="status" className="text-warning">{bg3MoveConfirmText(binding)}</p>
            <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
                <Button size="sm" onClick={onMove}>Move here</Button>
            </div>
        </div>
    );
}
