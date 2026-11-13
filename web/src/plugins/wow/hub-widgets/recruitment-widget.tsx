/**
 * ROK-1789 — the "Recruitment" card body (approved prototype
 * `RecruitmentStatus.tsx` + the spec's headline line, Q-A7): a headline
 * `StatusChip` + explainer, then the wanted rows sorted open → limited →
 * closed (each with its own chip), "Apply to join" and an "Updated … by …"
 * line. A Closed headline hides the list and Apply but the data is kept
 * (ruling A4). Editors see "Set recruitment" while unset; members see nothing.
 * Default export so the registration can `React.lazy` it.
 */
import { Suspense, lazy, useEffect, type JSX } from 'react';
import type { GuildRecruitment, GuildRecruitmentState, GuildRecruitmentView } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useGuildRecruitment } from '../hooks/use-guild-recruitment';
import { useRecruitmentDialog } from './recruitment-dialog-store';
import { RecruitmentNeedRow } from './recruitment-need-row';
import { RECRUIT_STATE_META, recruitmentUpdatedLine, sortWanted } from './recruitment.helpers';

const LazyRecruitmentDialog = lazy(() => import('./recruitment-dialog'));

export const RECRUITMENT_EMPTY_HINT = 'Tell applicants whether you’re recruiting';
export const ANY_CLASS_COPY = 'Any class or role';
export const APPLY_COPY = 'Apply to join →';

function Headline({ state }: { state: GuildRecruitmentState }): JSX.Element {
    const meta = RECRUIT_STATE_META[state];
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span data-testid="recruitment-headline">
                <StatusChip tone={meta.tone} title={`Recruitment: ${meta.label}`}>{meta.label}</StatusChip>
            </span>
            <p className="text-sm text-muted">{meta.explainer}</p>
        </div>
    );
}

function WantedList({ recruitment }: { recruitment: GuildRecruitment }): JSX.Element {
    if (recruitment.wanted.length === 0) return <p className="text-sm text-foreground">{ANY_CLASS_COPY}</p>;
    return (
        <ul className="divide-y divide-edge">
            {sortWanted(recruitment.wanted).map((n) => <RecruitmentNeedRow key={`${n.className}|${n.role}`} need={n} />)}
        </ul>
    );
}

/** External Apply link (A-D9): http(s) only by the contract, never an opener. */
function ApplyLink({ href }: { href: string }): JSX.Element {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-sm font-medium text-success hover:underline">
            {APPLY_COPY}
        </a>
    );
}

function CardBody({ view, recruitment }: { view: GuildRecruitmentView; recruitment: GuildRecruitment }): JSX.Element {
    const state = view.state ?? 'closed';
    const showList = state !== 'closed';
    return (
        <div className="flex flex-col gap-3" data-testid="recruitment-card">
            <Headline state={state} />
            {showList && <WantedList recruitment={recruitment} />}
            {showList && recruitment.applyUrl !== null && <ApplyLink href={recruitment.applyUrl} />}
            {view.updatedAt !== null && (
                <p data-testid="recruitment-updated" className="text-xs text-dim">
                    {recruitmentUpdatedLine(view.updatedAt, view.updatedBy)}
                </p>
            )}
        </div>
    );
}

function EditorEmpty({ guildId }: { guildId: number }): JSX.Element {
    const open = useRecruitmentDialog((s) => s.open);
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="recruitment-card">
            <p className="text-sm text-muted">{RECRUITMENT_EMPTY_HINT}</p>
            <Button variant="secondary" size="sm" data-testid="recruitment-set" onClick={() => open(guildId)}>Set recruitment</Button>
        </div>
    );
}

/** The editor dialog (L5), lazy-loaded, while the store says this hub's editor is open. */
function DialogMount({ guildId, gameSlug }: { guildId: number; gameSlug: string }): JSX.Element | null {
    const openFor = useRecruitmentDialog((s) => s.guildId);
    const close = useRecruitmentDialog((s) => s.close);
    if (openFor !== guildId) return null;
    return <Suspense fallback={null}><LazyRecruitmentDialog guildId={guildId} gameSlug={gameSlug} onClose={close} /></Suspense>;
}

/** Leaving the hub closes this hub's editor, so returning never reopens a stale dialog. */
function useCloseDialogOnUnmount(guildId: number): void {
    useEffect(() => () => {
        const store = useRecruitmentDialog.getState();
        if (store.guildId === guildId) store.close();
    }, [guildId]);
}

export default function RecruitmentWidget({ page, gameSlug }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const { data } = useGuildRecruitment(guildId);
    useCloseDialogOnUnmount(guildId);
    if (data === undefined) return null;
    const { recruitment, viewer } = data;
    if (recruitment === null && !viewer.canEdit) return null;
    // The dialog keeps one position across unset ↔ set, so a save never remounts it mid-edit.
    return (
        <>
            {viewer.canEdit && <DialogMount guildId={guildId} gameSlug={gameSlug} />}
            {recruitment === null ? <EditorEmpty guildId={guildId} /> : <CardBody view={data} recruitment={recruitment} />}
        </>
    );
}
