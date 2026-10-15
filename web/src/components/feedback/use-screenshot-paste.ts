/**
 * While mounted, a pasted image anywhere on the page becomes the feedback
 * screenshot (ROK-1313). Only image files are intercepted: a text paste into
 * the message box carries no file, so it is left to the browser untouched.
 * Non-PNG/JPEG images are still handed over, so the field can say why they
 * were refused instead of silently dropping them.
 */
import { useEffect, useRef } from 'react';

function pastedImage(data: DataTransfer | null): File | null {
    if (!data) return null;
    const files = Array.from(data.files ?? []);
    const fromItems = Array.from(data.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
    return [...files, ...fromItems].find((f) => f.type.startsWith('image/')) ?? null;
}

export function useScreenshotPaste(onFile: (file: File) => void): void {
    const latest = useRef(onFile);
    useEffect(() => { latest.current = onFile; }, [onFile]);
    useEffect(() => {
        const handle = (e: ClipboardEvent): void => {
            const file = pastedImage(e.clipboardData);
            if (!file) return;
            e.preventDefault();
            latest.current(file);
        };
        document.addEventListener('paste', handle);
        return () => document.removeEventListener('paste', handle);
    }, []);
}
