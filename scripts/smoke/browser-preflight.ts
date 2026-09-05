/**
 * Turning Playwright's browser-drift stack trace into a one-line remedy
 * (ROK-1466).
 *
 * The rl-infra runner image is built on `mcr.microsoft.com/playwright:v1.60.0-
 * jammy`, which bakes browser build 1223. The repo pins `@playwright/test`
 * 1.62.1, which wants build 1234. The failure arrives as a `browserType.launch`
 * stack pointing at `globalSetup`, which reads like a harness bug rather than
 * "this image is a Playwright minor behind".
 */

/** Playwright's own wording when the pinned browser build is not on disk. */
const MISSING_EXECUTABLE = /Executable doesn't exist at (.+)/;

/**
 * Describe a browser-launch failure as an actionable message, if it is one.
 *
 * @param err - The error thrown by `chromium.launch()`.
 * @returns A remediation message, or null when the error is unrelated.
 */
export function browserSetupHint(err: unknown): string | null {
    const message = err instanceof Error ? err.message : String(err);
    const match = MISSING_EXECUTABLE.exec(message);
    if (!match) return null;
    return [
        'Playwright browsers are missing or are the wrong build for this',
        `version of @playwright/test (expected at: ${match[1].trim()}).`,
        '',
        'On an rl-infra runner this means image drift: the base image bakes',
        'the browsers for its own Playwright minor, and the repo has since',
        'pinned a newer one. Install the matching build into the image path:',
        '',
        '    npx playwright install chromium',
        '',
        'Then re-run. Track the drift as a runner-image update — installing',
        'on every run costs ~115 MiB and ~20s.',
    ].join('\n');
}
