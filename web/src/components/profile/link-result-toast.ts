/**
 * The toast a `?linked=success|error[&provider=google][&message=…]` landing
 * shows on Profile (ROK-1630 Discord; ROK-2371 adds Google). An absent or
 * unknown `provider` is Discord — the Discord callback never sends one.
 */
export interface LinkResultToast {
    kind: 'success' | 'error';
    text: string;
}

function providerLabel(params: URLSearchParams): string {
    return params.get('provider') === 'google' ? 'Google' : 'Discord';
}

export function linkResultToast(params: URLSearchParams): LinkResultToast | null {
    const linked = params.get('linked');
    const label = providerLabel(params);
    if (linked === 'success') return { kind: 'success', text: `${label} account linked successfully!` };
    if (linked === 'error') return { kind: 'error', text: params.get('message') || `Failed to link ${label} account` };
    return null;
}
