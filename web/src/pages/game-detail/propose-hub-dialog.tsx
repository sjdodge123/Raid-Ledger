/**
 * ROK-1870 — "Start a community hub": `Modal` at 1024px and up, `BottomSheet`
 * below (design-system §4.4). The game is fixed to the page's game.
 */
import type { FormEvent, JSX } from 'react';
import { HUB_BLURB_MAX, HUB_NAME_MAX } from '@raid-ledger/contract';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { useProposalForm, type ProposalForm } from './propose-hub-form';

const FORM_ID = 'propose-hub-form';
const TITLE = 'Start a community hub';

export interface ProposeHubDialogProps {
    isOpen: boolean;
    onClose: () => void;
    gameId: number;
    gameName: string;
}

function ProposalFields({ form, gameName }: { form: ProposalForm; gameName: string }): JSX.Element {
    const onSubmit = (e: FormEvent): void => { e.preventDefault(); form.submit(); };
    return (
        <form id={FORM_ID} noValidate onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-secondary">Game: <span className="font-medium text-foreground">{gameName}</span></p>
            {form.errors.banner && (
                <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{form.errors.banner}</p>
            )}
            <Field label="Hub name" error={form.errors.name}
                hint={<>3–64 characters. Must be unique for this game. <span aria-live="polite">{form.name.length}/{HUB_NAME_MAX}</span></>}>
                <Input value={form.name} maxLength={HUB_NAME_MAX} invalid={Boolean(form.errors.name)}
                    onChange={(e) => form.setName(e.target.value)} />
            </Field>
            <Field label="Short description" error={form.errors.blurb}>
                <Textarea value={form.blurb} maxLength={HUB_BLURB_MAX} showCount rows={3} invalid={Boolean(form.errors.blurb)}
                    onChange={(e) => form.setBlurb(e.target.value)} />
            </Field>
            <p className="text-xs text-muted">An admin reviews new hubs — usually within a day. You&apos;ll lead it once approved.</p>
        </form>
    );
}

function Footer({ form, onCancel, full }: { form: ProposalForm; onCancel: () => void; full: boolean }): JSX.Element {
    return (
        <>
            <Button variant="ghost" fullWidth={full} onClick={onCancel}>Cancel</Button>
            <Button variant="primary" fullWidth={full} type="submit" form={FORM_ID} loading={form.isPending}>Send for review</Button>
        </>
    );
}

/** The proposal form, split Modal / BottomSheet by viewport. */
export function ProposeHubDialog({ isOpen, onClose, gameId, gameName }: ProposeHubDialogProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const form = useProposalForm(gameId, onClose);
    const cancel = (): void => { form.reset(); onClose(); };
    const body = <ProposalFields form={form} gameName={gameName} />;
    if (isDesktop) {
        return <Modal isOpen={isOpen} onClose={cancel} title={TITLE} footer={<Footer form={form} onCancel={cancel} full={false} />}>{body}</Modal>;
    }
    return <BottomSheet isOpen={isOpen} onClose={cancel} title={TITLE} footer={<Footer form={form} onCancel={cancel} full />}>{body}</BottomSheet>;
}
