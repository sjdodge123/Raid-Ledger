/**
 * ROK-1786 — "Guild rules & loot rules" (prototype `proposed/GuildRules.tsx`):
 * collapsible sections, each body rendered one item per line. Editors get an
 * inline editor (add / remove / reorder sections; title + multiline body).
 */
import { useState, type JSX } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import type { GuildRuleSection } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';
import { WidgetCard } from './guild-bits';
import { ruleLines } from './guild-content.helpers';
import { RulesEditor } from './guild-rules-editor';
import { useUpdateGuildProfile } from './use-guild-content';

function RuleSection({ section, index }: { section: GuildRuleSection; index: number }): JSX.Element {
    return (
        <ScrollCollapsible title={section.title} defaultOpen={index === 0}
            className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm">
            <ul className="flex list-disc flex-col gap-1 break-words pl-5 text-sm text-secondary" data-testid="guild-rule-items">
                {ruleLines(section.body).map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}
            </ul>
        </ScrollCollapsible>
    );
}

function RulesView({ rules, canEdit }: { rules: GuildRuleSection[]; canEdit: boolean }): JSX.Element {
    if (rules.length === 0) {
        return <p className="text-sm text-muted">{canEdit ? 'No rules yet. Add the first section.' : 'No rules posted yet.'}</p>;
    }
    return <div className="flex flex-col gap-2">{rules.map((s, i) => <RuleSection key={`${i}-${s.title}`} section={s} index={i} />)}</div>;
}

export function GuildRules({ guildId, rules, canEdit }: { guildId: number; rules: GuildRuleSection[]; canEdit: boolean }): JSX.Element {
    const [editing, setEditing] = useState(false);
    const save = useUpdateGuildProfile(guildId);
    const action = canEdit && !editing ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} data-testid="guild-rules-edit">
            <PencilSquareIcon className="h-4 w-4" aria-hidden="true" /> Edit rules
        </Button>
    ) : undefined;
    return (
        <WidgetCard id="guild-rules" title="Guild rules & loot rules" action={action}>
            {editing && canEdit ? (
                <RulesEditor initial={rules} saving={save.isPending} failed={!!save.error} onCancel={() => setEditing(false)}
                    onSave={(next) => save.mutate({ rules: next }, { onSuccess: () => setEditing(false) })} />
            ) : <RulesView rules={rules} canEdit={canEdit} />}
        </WidgetCard>
    );
}
