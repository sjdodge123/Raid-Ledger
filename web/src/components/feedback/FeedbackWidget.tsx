import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useSubmitFeedback } from '../../hooks/use-feedback';
import { captureMessageVerified } from '../../sentry';
import type {
    FeedbackCategory,
    CreateFeedbackDto,
} from '@raid-ledger/contract';
import { getClientLogs } from './feedback-console-capture';
import { FeedbackDialog } from './FeedbackDialog';

/**
 * Floating feedback widget — available to all authenticated users.
 * ROK-186: User Feedback Widget.
 *
 * On mobile the floating trigger is hidden; the MoreDrawer
 * opens the dialog via the onRegisterOpen callback instead.
 */
function useFeedbackState(submitFeedback: ReturnType<typeof useSubmitFeedback>) {
    const [isOpen, setIsOpen] = useState(false);
    const [category, setCategory] = useState<FeedbackCategory>('bug');
    const [message, setMessage] = useState('');
    const [includeClientLogs, setIncludeClientLogs] = useState(true);
    const [showSuccess, setShowSuccess] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sentryError, setSentryError] = useState(false);

    const resetRef = useRef(submitFeedback.reset);
    useEffect(() => { resetRef.current = submitFeedback.reset; }, [submitFeedback.reset]);

    const reset = useCallback(() => {
        setCategory('bug'); setMessage(''); setIncludeClientLogs(true);
        setShowSuccess(false); setIsSubmitting(false); setSentryError(false);
        resetRef.current();
    }, []);

    const handleOpen = useCallback(() => { reset(); setIsOpen(true); }, [reset]);
    const handleClose = useCallback(() => { setIsOpen(false); setTimeout(reset, 200); }, [reset]);

    return {
        isOpen, category, message, includeClientLogs, showSuccess, isSubmitting, sentryError,
        setCategory, setMessage, setIncludeClientLogs, setShowSuccess, setIsSubmitting, setSentryError,
        handleOpen, handleClose,
    };
}

function buildPayload(category: FeedbackCategory, message: string, includeClientLogs: boolean): CreateFeedbackDto {
    const payload: CreateFeedbackDto = { category, message, pageUrl: window.location.href };
    if (category === 'bug' && includeClientLogs) {
        const logs = getClientLogs();
        if (logs) payload.clientLogs = logs;
    }
    return payload;
}

function buildSentryOptions(category: FeedbackCategory, _message: string, feedbackId: number) {
    return {
        level: (category === 'bug' ? 'error' : 'info') as 'error' | 'info',
        tags: { feedback_category: category, feedback_id: String(feedbackId), source: 'feedback_widget' },
        contexts: { feedback: { pageUrl: window.location.href, category, feedbackId } },
    };
}

const FeedbackButton = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} className="hidden md:flex fixed bottom-6 right-6 z-40 h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
        style={{ backgroundColor: 'var(--color-accent)', color: 'white' }} title="Send Feedback" aria-label="Send Feedback">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
            <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 00-1.032-.211 50.89 50.89 0 00-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 002.433 3.984L7.28 21.53A.75.75 0 016 21v-4.03a48.527 48.527 0 01-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979z" />
            <path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 001.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0015.75 7.5z" />
        </svg>
    </button>
);

function useFeedbackSubmitHandler(
    state: ReturnType<typeof useFeedbackState>,
    submitFeedback: ReturnType<typeof useSubmitFeedback>,
) {
    return useCallback(() => {
        if (state.message.length < 10 || state.isSubmitting) return;
        state.setIsSubmitting(true); state.setSentryError(false);
        submitFeedback.mutate(buildPayload(state.category, state.message, state.includeClientLogs), {
            onSuccess: async (data) => {
                const ok = await captureMessageVerified(`[${state.category.toUpperCase()}] ${state.message}`, buildSentryOptions(state.category, state.message, data.id));
                if (ok) state.setShowSuccess(true); else state.setSentryError(true);
                state.setIsSubmitting(false);
            },
            onError: () => { state.setIsSubmitting(false); },
        });
    }, [state, submitFeedback]);
}

export function FeedbackWidget({ onRegisterOpen }: { onRegisterOpen?: (openFn: () => void) => void }) {
    const { isAuthenticated } = useAuth();
    const submitFeedback = useSubmitFeedback();
    const state = useFeedbackState(submitFeedback);
    const handleSubmit = useFeedbackSubmitHandler(state, submitFeedback);

    useEffect(() => { onRegisterOpen?.(state.handleOpen); }, [state.handleOpen, onRegisterOpen]);

    if (!isAuthenticated) return null;

    return (
        <div data-feedback-widget>
            <FeedbackButton onClick={state.handleOpen} />
            <FeedbackDialogWrapper state={state} submitFeedback={submitFeedback} handleSubmit={handleSubmit} />
        </div>
    );
}

function FeedbackDialogWrapper({ state, submitFeedback, handleSubmit }: {
    state: ReturnType<typeof useFeedbackState>; submitFeedback: ReturnType<typeof useSubmitFeedback>; handleSubmit: () => void;
}) {
    if (!state.isOpen) return null;
    return (
        <FeedbackDialog showSuccess={state.showSuccess} category={state.category} message={state.message}
            includeClientLogs={state.includeClientLogs} isSubmitting={state.isSubmitting} sentryError={state.sentryError}
            submitError={submitFeedback.error} isError={submitFeedback.isError}
            onCategoryChange={state.setCategory} onMessageChange={state.setMessage}
            onIncludeLogsChange={state.setIncludeClientLogs} onSubmit={handleSubmit} onClose={state.handleClose} />
    );
}
