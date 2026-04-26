/**
 * Hook for detecting pasted Steam store URLs and resolving
 * games via the API (ROK-945).
 *
 * Attaches a global paste listener that:
 * - Extracts Steam App IDs from store.steampowered.com URLs
 * - Skips detection when an input/textarea/contenteditable is focused
 * - Skips detection when the modal is already open
 * - Calls GET /games/by-steam-id/:id to resolve the game
 * - Returns the resolved game or shows an error toast
 */
import { useEffect, useCallback, useRef } from 'react';
import { getGameBySteamAppId } from '../lib/api-client';
import { toast } from '../lib/toast';
import type { IgdbGameDto } from '@raid-ledger/contract';

/** Regex to extract Steam App ID from a store URL. */
const STEAM_URL_RE = /store\.steampowered\.com\/app\/(\d+)/;

/** Returns true if the active element is an input-like field. */
function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/** Extract a numeric Steam App ID from pasted text, or null. */
export function extractSteamAppId(text: string): number | null {
  const match = STEAM_URL_RE.exec(text);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

interface UseSteamPasteOptions {
  /** Only listen when true (e.g. lineup is in building status). */
  enabled: boolean;
  /**
   * Modal-open flag. Retained for backward compatibility but no longer
   * gates the listener — the modal's own input-focused check is enough
   * to prevent double-handling, and detaching the page-level handler
   * meant pasting outside the search input did nothing (ROK-1114).
   */
  modalOpen?: boolean;
  /** Called with the resolved game to open the modal. */
  onGameResolved: (game: IgdbGameDto) => void;
}

/**
 * Registers a document-level paste listener that detects Steam
 * store URLs, resolves them via the API, and triggers the callback.
 *
 * The listener stays attached even while the nominate modal is open
 * so a paste anywhere outside an input field still resolves and slots
 * the game into the modal's preview card. Pastes that land inside an
 * input (the modal's search box) are skipped here — the modal owns
 * its own resolver for that path so the URL stays visible in the
 * field while resolving.
 */
export function useSteamPasteDetection({
  enabled,
  onGameResolved,
}: UseSteamPasteOptions): void {
  const loadingRef = useRef(false);

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (isInputFocused()) return;
      if (loadingRef.current) return;

      const text = e.clipboardData?.getData('text/plain') ?? '';
      const appId = extractSteamAppId(text);
      if (!appId) return;

      loadingRef.current = true;
      try {
        const game = await getGameBySteamAppId(appId);
        onGameResolved(game);
      } catch {
        toast.error('Game not found in library');
      } finally {
        loadingRef.current = false;
      }
    },
    [onGameResolved],
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [enabled, handlePaste]);
}
