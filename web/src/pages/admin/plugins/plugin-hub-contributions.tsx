/**
 * ROK-1969 §5.4 — the "Adds to hubs" block on a plugin card: the widgets, tabs
 * and hub behaviours the plugin declares (`PluginInfoDto.hub`), read from the
 * manifest, never hand-written. Planned (hidden) tabs are left off. A plugin
 * that adds nothing to hubs renders nothing.
 */
import { useId, type JSX } from 'react';
import type { PluginHubManifest } from '@raid-ledger/contract';

/** The card's existing section-label recipe (`PluginCard` TagList). */
export const SECTION_LABEL = 'text-xs font-medium text-dim uppercase tracking-wider';

interface ContributionItem {
    key: string;
    text: string;
    sub?: string | undefined;
}

/** "Adds to hubs" — Widgets / Tabs / Hub behaviours lists. */
export function PluginHubContributions({ hub }: { hub: PluginHubManifest }): JSX.Element | null {
    const headingId = useId();
    const widgets = hub.widgets.map((w) => ({ key: w.id, text: w.title, sub: w.description }));
    const tabs = hub.tabs.filter((t) => !t.planned).map((t) => ({ key: t.id, text: t.label }));
    const behaviours = hub.behaviours.map((b) => ({ key: `${b.kind}:${b.id}`, text: b.label }));
    if (widgets.length + tabs.length + behaviours.length === 0) return null;
    return (
        <section aria-labelledby={headingId} data-testid="plugin-hub-contributions">
            <h4 id={headingId} className="text-sm font-medium text-foreground">Adds to hubs</h4>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <ContributionList label="Widgets" items={widgets} />
                <ContributionList label="Tabs" items={tabs} />
                <ContributionList label="Hub behaviours" items={behaviours} />
            </div>
        </section>
    );
}

function ContributionList({ label, items }: { label: string; items: ContributionItem[] }): JSX.Element | null {
    if (items.length === 0) return null;
    return (
        <div className="min-w-0">
            <p className={SECTION_LABEL}>{label}</p>
            <ul aria-label={label} className="mt-1.5 space-y-1">
                {items.map((item) => (
                    <li key={item.key} className="text-sm text-secondary break-words">
                        {item.text}
                        {item.sub && <span className="block text-xs text-muted">{item.sub}</span>}
                    </li>
                ))}
            </ul>
        </div>
    );
}
