/**
 * "Screenshot (optional)" in the feedback form (ROK-1313). Empty: the shared
 * `FilePicker` (PNG/JPEG). Filled: a token-styled thumbnail plus a ghost
 * icon Button to remove it. A refused file shows the Field's inline
 * role=alert error, never a toast. Paste is handled by `useScreenshotPaste`
 * in the form; the object URL is owned (and revoked) by the state hook.
 */
import type { JSX } from 'react';
import { useId } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Field } from '../ui/field';
import { FilePicker } from '../ui/file-picker';
import { Button } from '../ui/button';
import type { FeedbackScreenshot } from './feedback-screenshot';

const HINT = "Paste with Ctrl/⌘+V or attach a PNG or JPEG. Check it doesn't show anything private.";

interface FeedbackScreenshotFieldProps {
    screenshot: FeedbackScreenshot | null;
    error: string | null;
    onFile: (file: File) => void;
    onRemove: () => void;
}

export function FeedbackScreenshotField({ screenshot, error, onFile, onRemove }: FeedbackScreenshotFieldProps): JSX.Element {
    const id = useId();
    return (
        <Field id={id} label="Screenshot (optional)" hint={HINT} error={error ?? undefined}>
            {screenshot ? (
                <div className="flex items-start gap-2">
                    <img src={screenshot.previewUrl} alt="Screenshot preview"
                        className="max-h-40 min-w-0 max-w-full rounded-lg border border-edge bg-overlay object-contain" />
                    <Button iconOnly variant="ghost" aria-label="Remove screenshot" onClick={onRemove}>
                        <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                    </Button>
                </div>
            ) : (
                <FilePicker accept="image/png,image/jpeg" variant="secondary" size="sm" inputProps={{ id }}
                    onFiles={(files) => { const first = files[0]; if (first) onFile(first); }}>
                    Attach screenshot
                </FilePicker>
            )}
        </Field>
    );
}
