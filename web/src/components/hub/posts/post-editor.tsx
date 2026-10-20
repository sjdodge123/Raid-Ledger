/**
 * ROK-1868 — inline edit of one post's body (Overview card; the Posts tab
 * reuses it). Edits never touch the Discord copy (D3), and say so.
 */
import { useState, type JSX } from 'react';
import { HUB_POST_BODY_MAX, type HubPost } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { LazyMarkdownEditor } from '../../ui/markdown/lazy-markdown-editor';
import { bodyError, serverBodyError } from './hub-post.helpers';
import { useUpdateHubPost } from './use-hub-posts';

export interface PostEditorProps { guildId: number; post: HubPost; onDone: () => void }

export function PostEditor({ guildId, post, onDone }: PostEditorProps): JSX.Element {
    const [draft, setDraft] = useState(post.body);
    const save = useUpdateHubPost(guildId);
    const localError = bodyError(draft);
    const error = localError ?? serverBodyError(save.error) ?? (save.isError ? 'Couldn’t save the post. Try again.' : undefined);
    const submit = (): void => save.mutate({ postId: post.id, body: draft.trim() }, { onSuccess: onDone });
    return (
        <div className="flex flex-col gap-3" data-testid="hub-post-editor">
            <Field label="Edit post" hideLabel error={error}>
                <LazyMarkdownEditor value={draft} onChange={setDraft} maxLength={HUB_POST_BODY_MAX} testId="hub-post-edit-body" autoFocus />
            </Field>
            {post.relay && <p className="text-xs text-muted">Edits update this page only — the Discord post isn’t changed.</p>}
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onDone}>Cancel</Button>
                <Button onClick={submit} loading={save.isPending} disabled={draft.trim() === '' || localError !== null}
                    data-testid="hub-post-save">Save</Button>
            </div>
        </div>
    );
}
