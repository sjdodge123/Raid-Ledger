/**
 * The open feedback dialog plus its form state and submit flow (ROK-186,
 * ROK-1313). Lazy-loaded by FeedbackWidget so the dialog, the screenshot
 * field and its hooks stay out of the entry chunk until the widget opens.
 * Mounted fresh on every open, so each open starts from a clean form.
 *
 * The mutation lives in FeedbackWidget (always mounted), so a submit that is
 * still in flight when the dialog closes still notifies Sentry on success.
 */
import { useState, useCallback, useRef, useEffect, type JSX } from 'react';
import type { useSubmitFeedback } from '../../hooks/use-feedback';
import { captureMessageVerified } from '../../sentry';
import type { FeedbackCategory, CreateFeedbackDto } from '@raid-ledger/contract';
import { getClientLogs } from './feedback-console-capture';
import { buildClientContext, screenshotFilename, type FeedbackScreenshot } from './feedback-screenshot';
import { useFeedbackScreenshot } from './use-feedback-screenshot';
import { FeedbackDialog } from './FeedbackDialog';
import { scrubFeedbackPayload, scrubSecretsFromText } from './feedback-scrub';

type SubmitFeedback = ReturnType<typeof useSubmitFeedback>;

function useFeedbackState(submitFeedback: SubmitFeedback) {
    const [category, setCategory] = useState<FeedbackCategory>('bug');
    const [message, setMessage] = useState('');
    const [includeClientLogs, setIncludeClientLogs] = useState(true);
    const [showSuccess, setShowSuccess] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sentryError, setSentryError] = useState(false);
    const shot = useFeedbackScreenshot();

    // Opening starts clean: clear the previous submit's error/success state.
    const resetRef = useRef(submitFeedback.reset);
    useEffect(() => { resetRef.current(); }, []);

    return {
        category, message, includeClientLogs, showSuccess, isSubmitting, sentryError,
        setCategory, setMessage, setIncludeClientLogs, setShowSuccess, setIsSubmitting, setSentryError,
        ...shot,
    };
}

function buildPayload(
    category: FeedbackCategory, message: string, includeClientLogs: boolean, screenshot: FeedbackScreenshot | null,
): CreateFeedbackDto {
    const payload: CreateFeedbackDto = {
        category, message, pageUrl: window.location.href, clientContext: buildClientContext(),
    };
    if (screenshot) payload.screenshotBase64 = screenshot.base64;
    if (category === 'bug' && includeClientLogs) {
        const logs = getClientLogs();
        if (logs) payload.clientLogs = logs;
    }
    // ROK-1838: a pasted join link (or one in the address bar / console logs)
    // must not reach the API or Sentry with its token intact.
    return scrubFeedbackPayload(payload);
}

function buildSentryOptions(
    category: FeedbackCategory,
    feedbackId: number,
    payload: Pick<CreateFeedbackDto, 'clientLogs' | 'clientContext'>,
) {
    const { clientLogs, clientContext } = payload;
    const feedbackContext: Record<string, unknown> = {
        pageUrl: scrubSecretsFromText(window.location.href),
        category,
        feedbackId,
    };
    if (clientContext) feedbackContext.clientContext = clientContext;
    // Sentry truncates contexts at 8 KiB; keep the tail so the most recent
    // events survive. DB column has full 50 KiB as source of truth.
    if (clientLogs) feedbackContext.clientLogs = clientLogs.slice(-7000);
    return {
        level: (category === 'bug' ? 'error' : 'info') as 'error' | 'info',
        tags: { feedback_category: category, feedback_id: String(feedbackId), source: 'feedback_widget' },
        contexts: { feedback: feedbackContext },
    };
}

function useFeedbackSubmitHandler(state: ReturnType<typeof useFeedbackState>, submitFeedback: SubmitFeedback) {
    return useCallback(() => {
        if (state.message.length < 10 || state.isSubmitting || state.isReadingScreenshot) return;
        state.setIsSubmitting(true); state.setSentryError(false);
        const { screenshot } = state;
        const payload = buildPayload(state.category, state.message, state.includeClientLogs, screenshot);
        const attachments = screenshot
            ? [{ filename: screenshotFilename(screenshot), data: screenshot.bytes, contentType: screenshot.mime }]
            : undefined;
        submitFeedback.mutate(payload, {
            onSuccess: async (data) => {
                const ok = await captureMessageVerified(
                    `[${payload.category.toUpperCase()}] ${payload.message}`,
                    buildSentryOptions(state.category, data.id, payload), attachments);
                if (ok) state.setShowSuccess(true); else state.setSentryError(true);
                state.setIsSubmitting(false);
            },
            onError: () => { state.setIsSubmitting(false); },
        });
    }, [state, submitFeedback]);
}

export function FeedbackPanel({ submitFeedback, onClose }: {
    submitFeedback: SubmitFeedback; onClose: () => void;
}): JSX.Element {
    const state = useFeedbackState(submitFeedback);
    const handleSubmit = useFeedbackSubmitHandler(state, submitFeedback);
    return (
        <FeedbackDialog showSuccess={state.showSuccess} category={state.category} message={state.message}
            includeClientLogs={state.includeClientLogs} isSubmitting={state.isSubmitting}
            isReadingScreenshot={state.isReadingScreenshot} sentryError={state.sentryError}
            submitError={submitFeedback.error} isError={submitFeedback.isError}
            onCategoryChange={state.setCategory} onMessageChange={state.setMessage}
            onIncludeLogsChange={state.setIncludeClientLogs} screenshot={state.screenshot}
            screenshotError={state.screenshotError} onScreenshotFile={state.attachScreenshot}
            onScreenshotRemove={state.clearScreenshot} onSubmit={handleSubmit} onClose={onClose} />
    );
}
