/**
 * ROK-1786 — inline editor for the rules sections: title + multiline body
 * (one rule per line), add / remove / reorder. Saves the whole list.
 */
import { useState, type JSX } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import {
    GUILD_RULE_BODY_MAX, GUILD_RULE_TITLE_MAX, GUILD_RULES_MAX_SECTIONS, type GuildRuleSection,
} from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { moveItem } from './guild-content.helpers';
import { EditorFooter, ItemControls } from './list-editor-bits';

interface Props {
    initial: GuildRuleSection[]; saving: boolean; failed: boolean;
    onSave: (rules: GuildRuleSection[]) => void; onCancel: () => void;
}

function SectionFields({ section, index, count, onChange, onMove, onRemove }: {
    section: GuildRuleSection; index: number; count: number;
    onChange: (s: GuildRuleSection) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}): JSX.Element {
    const name = section.title.trim() || `section ${index + 1}`;
    return (
        <li className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-3" data-testid="guild-rule-section-editor">
            <div className="flex items-end gap-2">
                <Field label="Section title" className="min-w-0 flex-1">
                    <Input value={section.title} maxLength={GUILD_RULE_TITLE_MAX} onChange={(e) => onChange({ ...section, title: e.target.value })} />
                </Field>
                <ItemControls name={name} index={index} count={count} onMove={onMove} onRemove={onRemove} />
            </div>
            <Field label="Rules" hint="One rule per line.">
                <Textarea rows={4} value={section.body} maxLength={GUILD_RULE_BODY_MAX} onChange={(e) => onChange({ ...section, body: e.target.value })} />
            </Field>
        </li>
    );
}

export function RulesEditor({ initial, saving, failed, onSave, onCancel }: Props): JSX.Element {
    const [draft, setDraft] = useState<GuildRuleSection[]>(initial);
    const set = (i: number, s: GuildRuleSection): void => setDraft((d) => d.map((x, j) => (j === i ? s : x)));
    const valid = draft.every((s) => s.title.trim() && s.body.trim());
    return (
        <div className="flex flex-col gap-3" data-testid="guild-rules-editor">
            <ul className="flex flex-col gap-2">
                {draft.map((s, i) => (
                    <SectionFields key={i} section={s} index={i} count={draft.length} onChange={(n) => set(i, n)}
                        onMove={(dir) => setDraft((d) => moveItem(d, i, dir))} onRemove={() => setDraft((d) => d.filter((_, j) => j !== i))} />
                ))}
            </ul>
            <div>
                <Button variant="secondary" size="sm" disabled={draft.length >= GUILD_RULES_MAX_SECTIONS}
                    onClick={() => setDraft((d) => [...d, { title: '', body: '' }])}>
                    <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add section
                </Button>
            </div>
            <EditorFooter saving={saving} failed={failed} canSave={valid} onCancel={onCancel} testId="guild-rules-save"
                onSave={() => onSave(draft.map((s) => ({ title: s.title.trim(), body: s.body.trim() })))} />
        </div>
    );
}
