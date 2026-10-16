/**
 * ROK-1599 (Codex P1 r3): keep the subscribe-feed bearer URL out of Session
 * Replay. `maskAllText`/`maskAllInputs` cover text and input values, but rrweb
 * records attributes verbatim unless `maskAttributeFn` masks them, and the SDK
 * masks only `title`/`placeholder`/`aria-label` by default — so a
 * `webcal://…/cal/u/<token>.ics` href would ship in a full snapshot.
 * `beforeAddRecordingEvent` sees custom events only, so it cannot scrub DOM
 * snapshots or mutations.
 *
 * Two layers: the subscribe-link element carries `data-sentry-block` (the
 * SDK's default block selector), and this module wraps the integration's
 * attribute masker so ANY href to a feed path or a `webcal:` scheme is masked
 * wherever it renders. The SDK exposes no public `maskAttributeFn` option, so
 * the wrap reaches the recording options it built; if their shape ever
 * changes, `guardFeedHrefs` reports false and the caller skips Replay
 * (fail closed). `sentry-replay.test.ts` pins the shape across upgrades.
 */

/** A feed URL in either form: the `webcal:` hand-off or the `/cal/u/` path. */
const FEED_HREF = /^\s*webcal:|\/cal\/u\//i;
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'xlink:href']);

/** The masked value for a feed-bearing URL attribute, or null to defer to the SDK. */
export function maskFeedHref(key: string, value: string): string | null {
    if (!URL_ATTRIBUTES.has(key.toLowerCase()) || !FEED_HREF.test(value)) return null;
    return value.replace(/\S/g, '*');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Wrap the Replay integration's attribute masker with `maskFeedHref`. Returns
 * false (nothing changed) when the recording options are not where expected.
 */
export function guardFeedHrefs(replay: object): boolean {
    const options: unknown = Reflect.get(replay, '_recordingOptions');
    if (!isRecord(options)) return false;
    const inner = options.maskAttributeFn;
    if (typeof inner !== 'function') return false;
    options.maskAttributeFn = (key: string, value: string, el: HTMLElement): string => {
        const masked = maskFeedHref(key, value);
        if (masked !== null) return masked;
        const out: unknown = Reflect.apply(inner, options, [key, value, el]);
        return typeof out === 'string' ? out : value;
    };
    return true;
}
