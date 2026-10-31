import { CopyableInput } from '../admin-form-helpers';

/** Both Discord redirect URLs with copy affordances (extracted from DiscordOAuthForm, ROK-1703). */
export function CallbackUrlsSection({ callbackUrl, linkCallbackUrl }: { callbackUrl: string; linkCallbackUrl: string }) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-1.5">
                <>Callback URLs <span className="text-dim">(add both to Discord)</span></>
            </label>
            <div className="mb-2">
                <CopyableInput value={callbackUrl} onCopied="Callback URL copied!" label="Callback URL" />
            </div>
            <CopyableInput value={linkCallbackUrl} onCopied="Link callback copied!" label="Link Callback URL" />
            <p className="text-xs text-dim mt-1.5">
                <>Click to copy. Add <strong>both</strong> URLs to Discord &rarr; OAuth2 &rarr; Redirects.</>
            </p>
        </div>
    );
}
