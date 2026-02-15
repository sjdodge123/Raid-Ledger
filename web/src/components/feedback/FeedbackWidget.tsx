import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useSubmitFeedback } from '../../hooks/use-feedback';
import { Sentry } from '../../sentry';
import type {
    FeedbackCategory,
    CreateFeedbackDto,
} from '@raid-ledger/contract';

const CATEGORIES: { value: FeedbackCategory; label: string; icon: string }[] = [
    { value: 'bug', label: 'Bug', icon: '\uD83D\uDC1B' },
    { value: 'feature', label: 'Feature', icon: '\u2728' },
    { value: 'improvement', label: 'Improvement', icon: '\uD83D\uDCA1' },
    { value: 'other', label: 'Other', icon: '\uD83D\uDCAC' },
];

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

/**
 * Capture recent console logs (errors, warnings, and info) from the browser.
 * Hooks into console methods to collect a rolling buffer of log entries.
 */
const MAX_LOG_ENTRIES = 100;
const logBuffer: string[] = [];
let consoleHooked = false;

function hookConsole() {
    if (consoleHooked) return;
    consoleHooked = true;

    const methods = ['error', 'warn', 'info', 'log'] as const;
    for (const method of methods) {
        const original = console[method];
        console[method] = (...args: unknown[]) => {
            const timestamp = new Date().toISOString();
            const text = args
                .map((a) => {
                    if (a instanceof Error) return `${a.name}: ${a.message}`;
                    if (typeof a === 'object') {
                        try {
                            return JSON.stringify(a);
                        } catch {
                            return String(a);
                        }
                    }
                    return String(a);
                })
                .join(' ');
            logBuffer.push(`[${timestamp}] [${method.toUpperCase()}] ${text}`);
            if (logBuffer.length > MAX_LOG_ENTRIES) {
                logBuffer.shift();
            }
            original.apply(console, args);
        };
    }
}

function getClientLogs(): string {
    return logBuffer.join('\n');
}

// Hook into console as early as possible
hookConsole();

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
    const [includeClientLogs, setIncludeClientLogs] = useState(true);
    const [showSuccess, setShowSuccess] = useState(false);

    // Use ref for submitFeedback.reset to avoid dependency churn in useCallback
    const resetRef = useRef(submitFeedback.reset);
    useEffect(() => {
        resetRef.current = submitFeedback.reset;
    }, [submitFeedback.reset]);

    const reset = useCallback(() => {
        setCategory('bug');
        setMessage('');
        setIncludeClientLogs(true);
        setShowSuccess(false);
        resetRef.current();
    }, []);

    const handleOpen = useCallback(() => {
        // Always reset form state when opening to prevent stale state
        // from blocking subsequent submissions
        reset();
        setIsOpen(true);
    }, [reset]);

    const handleClose = useCallback(() => {
        setIsOpen(false);
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

        // Attach client logs for bug reports when the user opts in
        if (category === 'bug' && includeClientLogs) {
            const logs = getClientLogs();
            if (logs) {
                payload.clientLogs = logs;
            }
        }

        // Dual-send: POST /feedback saves to local DB (persistent record for admin panel),
        // then Sentry.captureFeedback() forwards to the maintainer's Sentry project
        // for triaging and automatic GitHub issue creation via Sentry alert rules.
        submitFeedback.mutate(payload, {
            onSuccess: (data) => {
                // Send feedback to Sentry for maintainer visibility (ROK-306)
                try {
                    Sentry.captureFeedback({
                        message: `[${category.toUpperCase()}] ${message}`,
                        name: 'User Feedback',
                    }, {
                        captureContext: {
                            tags: {
                                feedback_category: category,
                                feedback_id: String(data.id),
                            },
                            contexts: {
                                feedback: {
                                    pageUrl: window.location.href,
                                    category,
                                    feedbackId: data.id,
                                },
                            },
                        },
                    });
                } catch {
                    // Sentry capture is best-effort — don't break the user flow
                }

                setShowSuccess(true);
            },
        });
    }, [category, message, includeClientLogs, submitFeedback]);

    // Only render for authenticated users
    if (!isAuthenticated) return null;

    return (
        <div data-feedback-widget>
            {/* Floating trigger button */}
            <button
                onClick={handleOpen}
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
                                    Your feedback has been recorded and sent to
                                    the maintainers.
                                </p>
                            </div>
                        ) : (
                            /* ── Form ── */
                            <>
                                {/* Category selector */}
                                <div className="mb-4">
                                    <label
                                        className="mb-2 block text-sm font-medium"
                                        style={{
                                            color: 'var(--color-foreground)',
                                        }}
                                    >
                                        Category
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {CATEGORIES.map((cat) => (
                                            <button
                                                key={cat.value}
                                                onClick={() =>
                                                    setCategory(cat.value)
                                                }
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
                                                <span className="mr-1">
                                                    {cat.icon}
                                                </span>
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Message textarea */}
                                <div className="mb-4">
                                    <label
                                        className="mb-2 block text-sm font-medium"
                                        style={{
                                            color: 'var(--color-foreground)',
                                        }}
                                    >
                                        Message
                                    </label>
                                    <textarea
                                        value={message}
                                        onChange={(e) =>
                                            setMessage(e.target.value)
                                        }
                                        placeholder="Tell us what's on your mind..."
                                        rows={4}
                                        maxLength={MAX_LENGTH}
                                        className="w-full resize-none rounded-lg p-3 text-sm outline-none transition-colors placeholder:text-[var(--color-muted)]"
                                        style={{
                                            backgroundColor:
                                                'var(--color-surface)',
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

                                {/* Client logs checkbox (bug category only) */}
                                {category === 'bug' && (
                                    <label
                                        className="mb-4 flex cursor-pointer items-center gap-2 text-sm"
                                        style={{ color: 'var(--color-muted)' }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={includeClientLogs}
                                            onChange={(e) =>
                                                setIncludeClientLogs(
                                                    e.target.checked,
                                                )
                                            }
                                            className="h-4 w-4 rounded accent-[var(--color-accent)]"
                                        />
                                        Capture and send client logs
                                    </label>
                                )}

                                {/* Powered by Sentry */}
                                <p
                                    className="mb-4 flex items-center gap-1 text-xs"
                                    style={{ color: 'var(--color-muted)' }}
                                >
                                    🛡️ Feedback is tracked via Sentry error monitoring.
                                </p>

                                {/* Error display */}
                                {submitFeedback.isError && (
                                    <p
                                        className="mb-3 text-sm"
                                        style={{
                                            color: 'var(--color-danger, #ef4444)',
                                        }}
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
