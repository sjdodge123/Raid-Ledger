/**
 * ROK-1960 §5 step 1 — the dashed drop zone (New pattern: a dashed drop zone
 * inside a sheet; the only precedent, `AvatarUploadZone`, is profile-specific).
 * The zone is a named `group` (its prompt) described by the saves-path hint;
 * the FilePicker's real `<button>` inside is its one keyboard/AT control. A
 * pointer click on the zone's background is a mouse-only shortcut to that same
 * picker (through its ref), so it adds no second tab stop and nests no
 * interactive role inside another.
 */
import { useId, useRef, useState, type DragEvent, type JSX } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { FilePicker } from '../../../components/ui/file-picker';
import { readDroppedFiles, type Bg3DroppedFiles } from './bg3-drop-files';

export const BG3_SAVES_PATH_HINT =
    "BG3 keeps saves in %LOCALAPPDATA%\\Larian Studios\\Baldur's Gate 3\\PlayerProfiles\\Public\\Savegames\\Story";

export interface Bg3UploadDropZoneProps {
    readonly onFiles: (dropped: Bg3DroppedFiles) => void;
    readonly busy: boolean;
}

export function Bg3UploadDropZone({ onFiles, busy }: Bg3UploadDropZoneProps): JSX.Element {
    const picker = useRef<HTMLInputElement>(null);
    const promptId = useId();
    const hintId = useId();
    const [over, setOver] = useState(false);
    const onDragOver = (e: DragEvent<HTMLDivElement>): void => { e.preventDefault(); setOver(true); };
    const onDrop = (e: DragEvent<HTMLDivElement>): void => {
        e.preventDefault();
        setOver(false);
        if (busy) return;
        void readDroppedFiles(e.dataTransfer).then(onFiles, () => onFiles({ files: [], folderName: null }));
    };
    return (
        <div className="flex flex-col gap-2">
            <div data-testid="bg3-upload-drop-zone" role="group" aria-labelledby={promptId} aria-describedby={hintId}
                onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop}
                onClick={(e) => { if (e.target === e.currentTarget && !busy) picker.current?.click(); }}
                className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed bg-panel p-6 text-center ${over ? 'border-success' : 'border-edge'}`}>
                <ArrowUpTrayIcon className="pointer-events-none h-6 w-6 text-muted" aria-hidden="true" />
                <p id={promptId} className="pointer-events-none text-sm text-secondary">Drag a save folder or .lsv file here</p>
                <FilePicker ref={picker} accept=".lsv" size="sm" loading={busy} loadingLabel="Reading the save…"
                    onFiles={(files) => onFiles({ files, folderName: null })} inputProps={{ 'data-testid': 'bg3-upload-input' }}>
                    Choose a save
                </FilePicker>
            </div>
            <p id={hintId} className="text-xs text-muted break-words">{BG3_SAVES_PATH_HINT}</p>
        </div>
    );
}
