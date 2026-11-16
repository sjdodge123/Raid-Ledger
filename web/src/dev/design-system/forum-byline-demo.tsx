/**
 * "via Discord" byline chip for /dev/design-system (docs/design-system.md, ROK-2208).
 *
 * Runs the real `forumByline` helper over a linked Discord message, a guest
 * Discord author and a plain Raid Ledger message, and renders the same `Pill`
 * `forum-message.tsx` uses. Tokens only, so it flips with the colour family.
 */
import type { JSX } from 'react';
import type { HubPostPerson } from '@raid-ledger/contract';
import { forumByline, type ForumBylineSource } from '../../components/hub/forum/forum-byline';
import { Pill } from '../../components/hub/hub-bits';
import { StateFrame } from './design-system-bits';

const PERSON: HubPostPerson = { userId: 1, displayName: 'Mirelle', avatarUrl: null };

const SAMPLES: Array<{ label: string; message: ForumBylineSource }> = [
    { label: 'Raid Ledger post', message: { author: PERSON, source: 'raidledger' } },
    { label: 'Linked, from Discord', message: { author: PERSON, source: 'discord' } },
    { label: 'Guest Discord author', message: { author: null, source: 'discord', discordAuthor: { name: 'Thornwick', avatarUrl: null } } },
];

/** One frame: each byline case with its chip (shown only when `viaDiscord`). */
export function ForumBylineDemo(): JSX.Element {
    return (
        <StateFrame label="Forum byline — via Discord chip" note="forum-byline.ts + forum-message.tsx: every Discord-origin message, guest or linked, carries the chip.">
            <ul className="w-full divide-y divide-edge-subtle" data-testid="ds-forum-byline">
                {SAMPLES.map(({ label, message }) => {
                    const { name, viaDiscord } = forumByline(message);
                    return (
                        <li key={label} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span className="text-sm">
                                <span className="font-semibold text-foreground">{name}</span>
                                {viaDiscord && <> <Pill title="Posted from Discord">via Discord</Pill></>}
                            </span>
                            <span className="text-xs text-muted">{label}</span>
                        </li>
                    );
                })}
            </ul>
        </StateFrame>
    );
}
