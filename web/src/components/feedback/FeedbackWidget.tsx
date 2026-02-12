import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useSubmitFeedback } from '../../hooks/use-feedback';
import type { FeedbackCategory, CreateFeedbackDto } from '@raid-ledger/contract';

const CATEGORIES: { value: FeedbackCategory; label: string; icon: string }[] = [
    { value: 'bug', label: 'Bug', icon: '\uD83D\uDC1B' },
    { value: 'feature', label: 'Feature', icon: '\u2728' },
    { value: 'improvement', label: 'Improvement', icon: '\uD83D\uDCA1' },
    { value: 'other', label: 'Other', icon: '\uD83D\uDCAC' },
];

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

/**
 * Capture a screenshot of the current page using html2canvas.
 * Returns the raw base64 content (no data URL prefix).
 */
async function captureScreenshot(): Promise<string> {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(document.body, {
        useCORS: true,
        scale: window.devicePixelRatio > 1 ? 1 : window.devicePixelRatio,
        logging: false,
        // Ignore the feedback widget itself in the screenshot
        ignoreElements: (el) => el.closest('[data-feedback-widget]') !== null,
    });
    // Convert to PNG data URL, then strip the prefix for raw base64
    const dataUrl = canvas.toDataURL('image/png', 0.8);
    return dataUrl.replace(/^data:image\/png;base64,/, '');
}

/**
 * Floating feedback widget — available to all authenticated users.
 * ROK-186: User Feedback Widget.
 */
export function FeedbackWidget() {
    const { isAuthenticated } = useAuth();
    const submitFeedback = useSubmitFeedback();

    const [isOpen, setIsOpen] = useState(false);
    const [category, setCategory] = useState<FeedbackCategory>('bug');
    const [message, setMessage] = useState('');
    const [showSuccess, setShowSuccess] = useState(false);
    const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);

    // Use ref for submitFeedback.reset to avoid dependency churn in useCallback
    const resetRef = useRef(submitFeedback.reset);
    resetRef.current = submitFeedback.reset;

    const reset = useCallback(() => {
        setCategory('bug');
        setMessage('');
        setScreenshotBase64(null);
        setIsCapturing(false);
        resetRef.current();
    }, []);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        setShowSuccess(false);
        // Delay reset so close animation completes
        setTimeout(reset, 200);
    }, [reset]);

    const handleSubmit = useCallback(() => {
        if (message.length < MIN_LENGTH) return;

        const payload: CreateFeedbackDto = {
            category,
            message,
            pageUrl: window.location.href,
        };

        // Include screenshot if captured
        if (screenshotBase64) {
            payload.screenshotBase64 = screenshotBase64;
        }

        submitFeedback.mutate(payload, {
            onSuccess: () => {
                setShowSuccess(true);
                setTimeout(() => {
                    handleClose();
                }, 2000);
            },
        });
    }, [category, message, screenshotBase64, submitFeedback, handleClose]);

    const handleCaptureScreenshot = useCallback(async () => {
        setIsCapturing(true);
        // Temporarily close the modal so it doesn't appear in the screenshot
        setIsOpen(false);

        // Wait for the modal to close and the DOM to settle
        await new Promise((resolve) => setTimeout(resolve, 300));

        try {
            const base64 = await captureScreenshot();
            setScreenshotBase64(base64);
        } catch (err) {
            console.error('Screenshot capture failed:', err);
        } finally {
            setIsOpen(true);
            setIsCapturing(false);
        }
    }, []);

    // Only render for authenticated users
    if (!isAuthenticated) return null;

    return (
        <div data-feedback-widget>
            {/* Floating trigger button */}
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
                style={{
                    backgroundColor: 'var(--color-accent)',
                    color: 'white',
                }}
                title="Send Feedback"
                aria-label="Send Feedback"
            >
                {/* Chat bubble icon */}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-6 w-6"
                >
                    <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 00-1.032-.211 50.89 50.89 0 00-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 002.433 3.984L7.28 21.53A.75.75 0 016 21v-4.03a48.527 48.527 0 01-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979z" />
                    <path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 001.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0015.75 7.5z" />
                </svg>
            </button>

            {/* Modal overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:items-center sm:justify-center"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) handleClose();
                    }}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

                    {/* Dialog */}
                    <div
                        className="relative w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
                        style={{
                            backgroundColor: 'var(--color-panel)',
                            border: '1px solid var(--color-border)',
                        }}
                    >
                        {/* Header */}
                        <div className="mb-4 flex items-center justify-between">
                            <h2
                                className="text-lg font-semibold"
                                style={{ color: 'var(--color-foreground)' }}
                            >
                                Send Feedback
                            </h2>
                            <button
                                onClick={handleClose}
                                className="rounded-lg p-1 transition-colors hover:bg-[var(--color-overlay)]"
                                style={{ color: 'var(--color-muted)' }}
                                aria-label="Close"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    className="h-5 w-5"
                                >
                                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                </svg>
                            </button>
                        </div>

                        {showSuccess ? (
                            /* ── Success state ── */
                            <div className="flex flex-col items-center gap-3 py-8">
                                <div
                                    className="flex h-16 w-16 items-center justify-center rounded-full"
                                    style={{
                                        backgroundColor:
                                            'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                                    }}
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        className="h-8 w-8"
                                        style={{ color: 'var(--color-accent)' }}
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                </div>
                                <p
                                    className="text-base font-medium"
                                    style={{ color: 'var(--color-foreground)' }}
                                >
                                    Thanks for your feedback!
                                </p>
                                <p
                                    className="text-sm"
                                    style={{ color: 'var(--color-muted)' }}
                                >
                                    We appreciate you helping us improve.
                                </p>
                            </div>
                        ) : (
                            /* ── Form ── */
                            <>
                                {/* Category selector */}
                                <div className="mb-4">
                                    <label
                                        className="mb-2 block text-sm font-medium"
                                        style={{ color: 'var(--color-foreground)' }}
                                    >
                                        Category
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {CATEGORIES.map((cat) => (
                                            <button
                                                key={cat.value}
                                                onClick={() => setCategory(cat.value)}
                                                className="rounded-full px-3 py-1.5 text-sm font-medium transition-all"
                                                style={{
                                                    backgroundColor:
                                                        category === cat.value
                                                            ? 'var(--color-accent)'
                                                            : 'var(--color-overlay)',
                                                    color:
                                                        category === cat.value
                                                            ? 'white'
                                                            : 'var(--color-foreground)',
                                                    border:
                                                        category === cat.value
                                                            ? '1px solid var(--color-accent)'
                                                            : '1px solid var(--color-border)',
                                                }}
                                            >
                                                <span className="mr-1">{cat.icon}</span>
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Message textarea */}
                                <div className="mb-4">
                                    <label
                                        className="mb-2 block text-sm font-medium"
                                        style={{ color: 'var(--color-foreground)' }}
                                    >
                                        Message
                                    </label>
                                    <textarea
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder="Tell us what's on your mind..."
                                        rows={4}
                                        maxLength={MAX_LENGTH}
                                        className="w-full resize-none rounded-lg p-3 text-sm outline-none transition-colors placeholder:text-[var(--color-muted)]"
                                        style={{
                                            backgroundColor: 'var(--color-surface)',
                                            border: '1px solid var(--color-border)',
                                            color: 'var(--color-foreground)',
                                        }}
                                        onFocus={(e) => {
                                            e.currentTarget.style.borderColor =
                                                'var(--color-accent)';
                                        }}
                                        onBlur={(e) => {
                                            e.currentTarget.style.borderColor =
                                                'var(--color-border)';
                                        }}
                                    />
                                    <div
                                        className="mt-1 flex justify-between text-xs"
                                        style={{ color: 'var(--color-muted)' }}
                                    >
                                        <span>
                                            {message.length < MIN_LENGTH
                                                ? `${MIN_LENGTH - message.length} more characters needed`
                                                : '\u00A0'}
                                        </span>
                                        <span>
                                            {message.length}/{MAX_LENGTH}
                                        </span>
                                    </div>
                                </div>

                                {/* Screenshot section */}
                                <div className="mb-4">
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleCaptureScreenshot}
                                            disabled={isCapturing || submitFeedback.isPending}
                                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
                                            style={{
                                                backgroundColor: 'var(--color-overlay)',
                                                color: 'var(--color-foreground)',
                                                border: '1px solid var(--color-border)',
                                            }}
                                            title="Capture a screenshot of the current page"
                                        >
                                            {/* Camera icon */}
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                                className="h-4 w-4"
                                            >
                                                <path
                                                    fillRule="evenodd"
                                                    d="M1 8a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 018.07 3h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8zm13.5 3a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM10 14a3 3 0 100-6 3 3 0 000 6z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                            {isCapturing ? 'Capturing...' : 'Capture Screenshot'}
                                        </button>
                                        {screenshotBase64 && (
                                            <button
                                                type="button"
                                                onClick={() => setScreenshotBase64(null)}
                                                className="rounded-lg p-1.5 text-sm transition-colors hover:bg-[var(--color-overlay)]"
                                                style={{ color: 'var(--color-muted)' }}
                                                title="Remove screenshot"
                                                aria-label="Remove screenshot"
                                            >
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 20 20"
                                                    fill="currentColor"
                                                    className="h-4 w-4"
                                                >
                                                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                    {/* Screenshot preview */}
                                    {screenshotBase64 && (
                                        <div
                                            className="mt-2 overflow-hidden rounded-lg"
                                            style={{
                                                border: '1px solid var(--color-border)',
                                            }}
                                        >
                                            <img
                                                src={`data:image/png;base64,${screenshotBase64}`}
                                                alt="Screenshot preview"
                                                className="w-full object-contain"
                                                style={{ maxHeight: '150px' }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Error display */}
                                {submitFeedback.isError && (
                                    <p
                                        className="mb-3 text-sm"
                                        style={{ color: 'var(--color-danger, #ef4444)' }}
                                    >
                                        {submitFeedback.error?.message ||
                                            'Something went wrong. Please try again.'}
                                    </p>
                                )}

                                {/* Submit button */}
                                <button
                                    onClick={handleSubmit}
                                    disabled={
                                        message.length < MIN_LENGTH ||
                                        submitFeedback.isPending
                                    }
                                    className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
                                    style={{
                                        backgroundColor: 'var(--color-accent)',
                                    }}
                                >
                                    {submitFeedback.isPending
                                        ? 'Sending...'
                                        : 'Send Feedback'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
