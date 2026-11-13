/**
 * ROK-1789 — the Recruitment editor's form body: the Recruiting checkbox
 * (Q-A5; a form field saved later is a `Checkbox`, not a `Switch`,
 * design-system §Checkbox), a preview of the card headline the draft would
 * show (derived by the contract's `recruitmentHeadline`, A-D3), the wanted
 * rows (still editable while off, so the kept list can be tidied), the
 * all-closed hint and the apply link with its inline error.
 */
import type { Dispatch, JSX, SetStateAction } from 'react';
import type { GuildRecruitmentState } from '@raid-ledger/contract';
import { Checkbox } from '../../../components/ui/checkbox';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { StatusChip } from '../../../components/ui/status-chip';
import { RecruitmentWantedEditor } from './recruitment-wanted-editor';
import {
    RECRUIT_STATE_META, draftHeadline, isAllClosed, recruitClassesFor,
    type DraftErrors, type DraftWanted, type RecruitmentDraft,
} from './recruitment.helpers';

export const RECRUITING_DESCRIPTION = "Off shows 'Not recruiting right now.' and hides the list and the Apply link. Your list is kept.";
export const ALL_CLOSED_HINT = 'Every class is Closed, so the card reads Not recruiting right now.';
const APPLY_HINT = 'A full http(s) link, e.g. a form or Discord invite.';

function HeadlinePreview({ state }: { state: GuildRecruitmentState }): JSX.Element {
    const meta = RECRUIT_STATE_META[state];
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="recruitment-headline-preview">
            <span>The card shows</span>
            <StatusChip tone={meta.tone} title={`Recruitment: ${meta.label}`}>{meta.label}</StatusChip>
            <span>{meta.explainer}</span>
        </div>
    );
}

export interface RecruitmentFieldsProps {
    draft: RecruitmentDraft;
    errors: DraftErrors;
    gameSlug: string | undefined;
    setDraft: Dispatch<SetStateAction<RecruitmentDraft>>;
}

/** The editor's fields; every change goes through `setDraft`. */
export function RecruitmentFields({ draft, errors, gameSlug, setDraft }: RecruitmentFieldsProps): JSX.Element {
    const setRows = (next: (rows: DraftWanted[]) => DraftWanted[]): void => setDraft((d) => ({ ...d, wanted: next(d.wanted) }));
    return (
        <div className="flex flex-col gap-4">
            <Checkbox label="Recruiting" description={RECRUITING_DESCRIPTION} checked={draft.recruiting} data-testid="recruitment-recruiting"
                onChange={(e) => { const on = e.target.checked; setDraft((d) => ({ ...d, recruiting: on })); }} />
            <HeadlinePreview state={draftHeadline(draft)} />
            <div className="flex flex-col gap-1">
                <RecruitmentWantedEditor rows={draft.wanted} classes={recruitClassesFor(gameSlug)} errors={errors.rows} onChange={setRows} />
                {isAllClosed(draft) && <p data-testid="recruitment-all-closed" className="text-xs text-muted">{ALL_CLOSED_HINT}</p>}
            </div>
            <Field label="Apply link" hint={APPLY_HINT} error={errors.applyUrl ?? undefined}>
                <Input type="url" inputMode="url" data-testid="recruitment-apply-url" value={draft.applyUrl} placeholder="https://"
                    invalid={errors.applyUrl !== null}
                    onChange={(e) => { const url = e.target.value; setDraft((d) => ({ ...d, applyUrl: url })); }} />
            </Field>
            {errors.other !== null && <p className="text-xs text-danger" data-testid="recruitment-form-error">{errors.other}</p>}
        </div>
    );
}
