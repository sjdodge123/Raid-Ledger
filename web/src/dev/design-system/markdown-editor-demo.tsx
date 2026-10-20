/**
 * MarkdownEditor demo for /dev/design-system (ROK-1868, spec §3.6). Mounts the
 * REAL editor through `LazyMarkdownEditor` — the only import path — so the
 * TipTap chunk stays out of DesignSystemPage's own chunk (a 20 KB-capped dev
 * route) and the `aria-busy` loading frame is visible on a cold load. Check the
 * toolbar's active state, the link row and the counter in default-dark AND
 * default-light (the side-by-side toggle renders this twice).
 */
import { useState, type JSX } from 'react';
import { Field } from '../../components/ui/field';
import { LazyMarkdownEditor } from '../../components/ui/markdown/lazy-markdown-editor';
import { StateFrame } from './design-system-bits';

const START = 'Raid night is **Thursday**. Bring `flasks` and read [the guide](/guides/raid).\n\n- Tanks: soak the frontal\n- Healers: cooldown sheet';

/** One live editor wired through `Field`, with a short limit so the counter is easy to push over. */
export function MarkdownEditorStates(): JSX.Element {
    const [body, setBody] = useState<string>(START);
    const over = body.length > 200;
    return (
        <StateFrame label="MarkdownEditor — lazy, toolbar + link row" note="Loaded via LazyMarkdownEditor (own chunk). Select text, then Bold / Link (Mod-K); a bare host gains https://. Counter = markdown SOURCE length; past 200 the frame turns invalid.">
            <Field label="Post body" error={over ? 'Keep it under 200 characters.' : undefined} className="w-full">
                <LazyMarkdownEditor value={body} onChange={setBody} maxLength={200} invalid={over} testId="ds-md-editor" />
            </Field>
        </StateFrame>
    );
}
