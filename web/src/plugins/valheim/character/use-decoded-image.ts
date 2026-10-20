/**
 * ROK-1836 D7 — an image URL becomes drawable only once the browser has
 * decoded it. A CSS background cannot report a decode failure, so a PNG that
 * downloads but is corrupt would otherwise paint every sprite blank.
 */
import { useEffect, useState } from 'react';

function decodeImage(url: string): Promise<void> {
    const img = new Image();
    if (typeof img.decode !== 'function') {
        return new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('image decode failed'));
            img.src = url;
        });
    }
    img.src = url;
    return img.decode();
}

/** `url` once it has decoded; null while decoding, after a failure, or for a null url. */
export function useDecodedImage(url: string | null): string | null {
    const [decoded, setDecoded] = useState<string | null>(null);
    useEffect(() => {
        if (url === null) return undefined;
        let live = true;
        decodeImage(url).then(
            () => {
                if (live) setDecoded(url);
            },
            () => undefined,
        );
        return () => {
            live = false;
        };
    }, [url]);
    return decoded !== null && decoded === url ? decoded : null;
}
