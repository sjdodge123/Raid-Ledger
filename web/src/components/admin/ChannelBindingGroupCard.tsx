/**
 * ROK-2106 — one Discord channel in the admin bindings list: a header (kind
 * icon, #name, binding count), the channel-level lifecycle chips and the
 * multi-monitor notice ONCE, then one compact row per binding (children).
 */
import type { JSX, ReactNode } from 'react';
import type { ChannelBindingGroup } from './channel-binding-groups';
import { ChannelBindingLifecycleCell, type LifecyclePinState } from './channel-binding-lifecycle-cell';

function ChannelTypeIcon({ type }: { type: string }): JSX.Element {
    if (type === 'voice') {
        return <svg aria-hidden="true" className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>;
    }
    return <svg aria-hidden="true" className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /></svg>;
}

function MultiMonitorNote(): JSX.Element {
    return (
        <p className="text-xs text-warning mt-2">
            Heads up: this channel monitors more than one game. While a scheduled event for one game is
            live, Quick Play pauses for the others on this channel until it ends. This is a supported setup.
        </p>
    );
}

function GroupHeader({ group }: { group: ChannelBindingGroup }): JSX.Element {
    const count = group.bindings.length;
    return (
        <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="flex-shrink-0"><ChannelTypeIcon type={group.channelType} /></span>
            <span data-testid="channel-binding-group-name" className="text-sm font-medium text-foreground break-all min-w-0">
                #{group.displayName}
            </span>
            <span aria-label={`${count} ${count === 1 ? 'binding' : 'bindings'}`}
                className="px-2 py-0.5 text-xs rounded-full bg-overlay text-muted">
                {count}
            </span>
        </div>
    );
}

interface ChannelBindingGroupCardProps {
    group: ChannelBindingGroup;
    /** Pin wiring for the group's lifecycle binding (ignored when it has none). */
    pin: LifecyclePinState;
    /** The group's binding rows. */
    children: ReactNode;
}

/** A channel card: header, channel-level lifecycle + notice once, then the binding rows. */
export function ChannelBindingGroupCard({ group, pin, children }: ChannelBindingGroupCardProps): JSX.Element {
    return (
        <section data-testid="channel-binding-group" aria-label={`#${group.displayName}`}
            className="p-3 sm:p-4 rounded-lg border border-edge bg-panel/50">
            <GroupHeader group={group} />
            {group.lifecycleBinding && <ChannelBindingLifecycleCell binding={group.lifecycleBinding} pin={pin} />}
            {group.hasMultiMonitor && <MultiMonitorNote />}
            <div className="space-y-2 mt-3">{children}</div>
        </section>
    );
}
