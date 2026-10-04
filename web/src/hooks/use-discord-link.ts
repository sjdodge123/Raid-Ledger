import { useCallback } from 'react';
import { useLinkStart } from './use-link-start';

/**
 * ROK-1630: the Discord account-linking initiator with its pending state.
 * POSTs /auth/discord/link/start (Bearer header only), then navigates to the
 * single-use `?nonce=` hop. Disable the trigger while `isPending` is true.
 */
export function useDiscordLinkAction() {
    const { start, isPending } = useLinkStart('discord');
    // Takes no arguments on purpose: a caller wiring this straight to onClick
    // passes the click event, which must never become a request body field.
    const linkDiscord = useCallback(() => start(), [start]);
    return { linkDiscord, isPending };
}

/** Stable callback that starts Discord account linking (see useDiscordLinkAction). */
export function useDiscordLink() {
    return useDiscordLinkAction().linkDiscord;
}
