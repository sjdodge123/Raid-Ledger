/**
 * LineupShareCopy (ROK-1323) — the member-visible "Copy link" affordance for
 * a public-share-enabled lineup. Preservation-risk #2: the public-share
 * TOGGLE moves into the operator ⋮ menu, but ordinary members must still be
 * able to copy the already-public link, so this control renders for everyone
 * (when `publicShareEnabled`).
 *
 * Two presentations via `variant`:
 *   - `icon` (default): a compact icon button shown next to the back button
 *     for non-operators.
 *   - `item`: a full-width menu row used inside the operator ⋮ menu's
 *     Sharing section.
 */
import type { JSX } from 'react';
import { toast } from '../../lib/toast';

function copyPublicLink(slug: string): void {
  const url = `${window.location.origin}/p/lineup/${slug}`;
  void navigator.clipboard
    .writeText(url)
    .then(() => toast.success('Public link copied'))
    .catch(() => toast.error('Failed to copy link'));
}

export function LineupShareCopy({
  slug,
  variant = 'icon',
  onCopied,
}: {
  slug: string;
  variant?: 'icon' | 'item';
  /** Fired after the copy is triggered (e.g. to close the menu). */
  onCopied?: () => void;
}): JSX.Element {
  const handleClick = (): void => {
    copyPublicLink(slug);
    onCopied?.();
  };

  if (variant === 'item') {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={handleClick}
        data-testid="lineup-share-copy"
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-secondary hover:bg-panel hover:text-foreground transition-colors"
      >
        <CopyIcon />
        Copy link
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="lineup-share-copy"
      aria-label="Copy public link"
      title="Copy public link"
      className="inline-flex items-center justify-center min-h-[32px] px-2.5 py-1.5 text-xs text-muted hover:text-foreground rounded border border-edge/50 hover:bg-overlay/50 transition-colors flex-shrink-0"
    >
      <CopyIcon />
      <span className="hidden sm:inline ml-1">Copy link</span>
    </button>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}
