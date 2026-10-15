/**
 * The feedback dialog's screenshot state (ROK-1313): validate → read → keep,
 * with the inline error for a refused file. Owns the preview's object URL and
 * revokes it whenever the screenshot is replaced, removed or the widget
 * unmounts. A slower earlier read never overwrites a newer pick.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    readScreenshot, validateScreenshotFile, SCREENSHOT_ERROR, type FeedbackScreenshot,
} from './feedback-screenshot';

export interface FeedbackScreenshotState {
    screenshot: FeedbackScreenshot | null;
    screenshotError: string | null;
    attachScreenshot: (file: File) => void;
    clearScreenshot: () => void;
}

export function useFeedbackScreenshot(): FeedbackScreenshotState {
    const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null);
    const [screenshotError, setError] = useState<string | null>(null);
    const current = useRef<FeedbackScreenshot | null>(null);
    const pick = useRef(0);

    const replace = useCallback((next: FeedbackScreenshot | null) => {
        if (current.current) URL.revokeObjectURL(current.current.previewUrl);
        current.current = next;
        setScreenshot(next);
    }, []);

    const attachScreenshot = useCallback((file: File) => {
        const problem = validateScreenshotFile(file);
        setError(problem);
        if (problem) return;
        const mine = ++pick.current;
        readScreenshot(file).then(
            (shot) => { if (mine === pick.current) replace(shot); else URL.revokeObjectURL(shot.previewUrl); },
            () => { if (mine === pick.current) setError(SCREENSHOT_ERROR); },
        );
    }, [replace]);

    const clearScreenshot = useCallback(() => { pick.current += 1; replace(null); setError(null); }, [replace]);

    useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current.previewUrl); }, []);

    return { screenshot, screenshotError, attachScreenshot, clearScreenshot };
}
