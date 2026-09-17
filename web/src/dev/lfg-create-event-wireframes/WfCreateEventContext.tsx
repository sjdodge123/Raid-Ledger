/**
 * ROK-1573 L5 — `/events/new?lfgGameId=…` arriving from the LFG group.
 *
 * Mirrors `CreateEventPage`'s container, back button and header verbatim and
 * adds the context note under the subtitle. The form itself is NOT mounted:
 * `CreateEventForm` reads the game registry, templates and the auth user over
 * the network, and this route is fixture-only. It is unchanged by this story,
 * so a placeholder stands in for it.
 */
import type { JSX } from 'react';

export const WF_CREATE_CONTEXT_NOTE = 'From the PEAK group — its 4 members are signed up when you create it.';

/** The shipped back button, copied (it is file-private in the page). */
function BackButton(): JSX.Element {
    return (
        <button type="button" className="flex items-center gap-2 text-muted hover:text-foreground transition-colors mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
        </button>
    );
}

/** Stand-in for the unchanged form body. */
function FormPlaceholder(): JSX.Element {
    return (
        <div className="space-y-4">
            {['Game · PEAK (prefilled)', 'Title', 'Start · Tonight 8 PM (prefilled)', 'Duration'].map((label) => (
                <div key={label} className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <div className="h-10 rounded-lg bg-overlay" />
                </div>
            ))}
            <p className="text-xs text-dim">The existing create-event form mounts here unchanged.</p>
        </div>
    );
}

/** L5 — create-event page header with the LFG context note. */
export function WfCreateEventContext(): JSX.Element {
    return (
        <div data-testid="wf-create-event-context" className="py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <BackButton />
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground mb-2">Create Event</h1>
                    <p className="text-muted">Set up a new gaming session for your community</p>
                    <p className="mt-3 rounded-lg bg-overlay px-3 py-2 text-sm text-foreground">{WF_CREATE_CONTEXT_NOTE}</p>
                </div>
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <FormPlaceholder />
                </div>
            </div>
        </div>
    );
}
