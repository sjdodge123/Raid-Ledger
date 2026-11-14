/**
 * ROK-1175 — the forum composers: a new thread (title + markdown body, a
 * `DiscardChangesConfirm` when leaving with text), a reply (body only), and
 * the author's in-place edit of a thread or reply (Q5, inside 24 h — the
 * caller only offers it when the server's `can.edit` says so).
 */
import { useState, type JSX } from 'react';
import type { HubForumReply, HubForumThread } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { DiscardChangesConfirm } from '../../ui/discard-changes-confirm';
import { bodyError, serverBodyError } from '../posts/hub-post.helpers';
import { ForumBodyField, ForumTitleField } from './forum-fields';
import { forumTitleError } from './forum-thread.helpers';
import { useCreateForumReply, useCreateForumThread } from './use-hub-forum';

function submitError(local: string | null, err: Error | null, fallback: string): string | undefined {
    return local ?? serverBodyError(err) ?? (err ? fallback : undefined);
}

export interface ThreadComposerProps { guildId: number; onCancel: () => void; onPosted: (thread: HubForumThread) => void }

/** "New thread": Post stays disabled while the title or body is empty or invalid. */
export function ForumThreadComposer({ guildId, onCancel, onPosted }: ThreadComposerProps): JSX.Element {
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [confirmLeave, setConfirmLeave] = useState(false);
    const create = useCreateForumThread(guildId);
    const titleErr = forumTitleError(title);
    const bodyErr = bodyError(body);
    const blocked = title.trim() === '' || body.trim() === '' || titleErr !== null || bodyErr !== null;
    const leave = (): void => { if (title.trim() + body.trim() === '') onCancel(); else setConfirmLeave(true); };
    const submit = (): void => create.mutate({ title: title.trim(), body: body.trim() }, { onSuccess: onPosted });
    return (
        <section className="flex flex-col gap-3 rounded-lg border border-edge bg-surface p-4" data-testid="hub-forum-composer" aria-label="New thread">
            <h3 className="font-semibold text-foreground">New thread</h3>
            <ForumTitleField value={title} onChange={setTitle} error={titleErr ?? undefined} />
            <ForumBodyField label="Message" value={body} onChange={setBody} testId="forum-body-input"
                error={submitError(bodyErr, create.error, 'Couldn’t post the thread. Try again.')} />
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={leave}>Cancel</Button>
                <Button onClick={submit} loading={create.isPending} disabled={blocked} data-testid="forum-thread-submit">Post thread</Button>
            </div>
            <DiscardChangesConfirm isOpen={confirmLeave} onKeep={() => setConfirmLeave(false)} onDiscard={onCancel}
                message="Your thread hasn’t been posted yet." />
        </section>
    );
}

export interface ReplyComposerProps { guildId: number; threadId: number; onPosted?: ((reply: HubForumReply) => void) | undefined }

/** The reply box under a live thread; clears after a successful reply and hands the reply to `onPosted`. */
export function ForumReplyComposer({ guildId, threadId, onPosted }: ReplyComposerProps): JSX.Element {
    const [body, setBody] = useState('');
    const create = useCreateForumReply(guildId);
    const localErr = bodyError(body);
    const posted = (reply: HubForumReply): void => { setBody(''); onPosted?.(reply); };
    const submit = (): void => create.mutate({ threadId, body: body.trim() }, { onSuccess: posted });
    return (
        <div className="flex flex-col gap-2" data-testid="forum-reply-composer">
            <ForumBodyField label="Reply" hideLabel value={body} onChange={setBody} testId="forum-reply-input"
                error={submitError(localErr, create.error, 'Couldn’t post the reply. Try again.')} />
            <div className="flex justify-end">
                <Button onClick={submit} loading={create.isPending} disabled={body.trim() === '' || localErr !== null}
                    data-testid="forum-reply-submit">Reply</Button>
            </div>
        </div>
    );
}

export interface MessageEditorProps {
    /** The thread's title when editing the root; omitted for a reply. */
    title?: string | undefined;
    body: string;
    pending: boolean;
    failed: Error | null;
    onSave: (next: { title?: string; body: string }) => void;
    onCancel: () => void;
}

/** In-place edit (author, inside 24 h): the root edits title + body, a reply its body; Cancel with changes asks first. */
export function ForumMessageEditor({ title, body, pending, failed, onSave, onCancel }: MessageEditorProps): JSX.Element {
    const [nextTitle, setNextTitle] = useState(title ?? '');
    const [nextBody, setNextBody] = useState(body);
    const titleErr = title === undefined ? null : forumTitleError(nextTitle);
    const bodyErr = bodyError(nextBody);
    const blocked = nextBody.trim() === '' || bodyErr !== null || titleErr !== null || (title !== undefined && nextTitle.trim() === '');
    const save = (): void => onSave({ ...(title === undefined ? {} : { title: nextTitle.trim() }), body: nextBody.trim() });
    const [confirmLeave, setConfirmLeave] = useState(false);
    const dirty = nextBody !== body || (title !== undefined && nextTitle !== title);
    const cancel = (): void => { if (dirty) setConfirmLeave(true); else onCancel(); };
    return (
        <div className="flex flex-col gap-3" data-testid="forum-message-editor">
            {title !== undefined && <ForumTitleField value={nextTitle} onChange={setNextTitle} error={titleErr ?? undefined} />}
            <ForumBodyField label="Edit message" hideLabel={title === undefined} value={nextBody} onChange={setNextBody} testId="forum-edit-body"
                autoFocus={title === undefined} error={submitError(bodyErr, failed, 'Couldn’t save. Try again.')} />
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={cancel}>Cancel</Button>
                <Button onClick={save} loading={pending} disabled={blocked} data-testid="forum-edit-save">Save</Button>
            </div>
            <DiscardChangesConfirm isOpen={confirmLeave} onKeep={() => setConfirmLeave(false)} onDiscard={onCancel}
                message="Your edit hasn’t been saved yet." />
        </div>
    );
}
