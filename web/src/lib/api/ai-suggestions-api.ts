/**
 * AI Suggestions API client (ROK-931).
 *
 * `GET /lineups/:id/suggestions` returns 503 when no LLM provider is
 * configured — the hook layer translates that into a typed
 * `unavailable: true` surface instead of a thrown Error. Everything
 * else (200 / 404 / 409 / network failure) passes through the normal
 * `fetchApi` path.
 */
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../config';
import { getAuthToken } from '../../hooks/use-auth';

export interface AiSuggestionsSuccess {
  kind: 'ok';
  data: AiSuggestionsResponseDto;
}
export interface AiSuggestionsUnavailable {
  kind: 'unavailable';
}
export type AiSuggestionsResult =
  | AiSuggestionsSuccess
  | AiSuggestionsUnavailable;

export interface GetAiSuggestionsParams {
  /** When true, the request includes `?personalize=me`. */
  personalize?: boolean;
}

export async function getAiSuggestions(
  lineupId: number,
  params: GetAiSuggestionsParams = {},
): Promise<AiSuggestionsResult> {
  const query = params.personalize ? '?personalize=me' : '';
  const token = getAuthToken();
  const response = await fetch(
    `${API_BASE_URL}/lineups/${lineupId}/suggestions${query}`,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    },
  );

  if (response.status === 503) return { kind: 'unavailable' };
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(
      body.message ? String(body.message) : `HTTP ${response.status}`,
    );
  }
  const data = (await response.json()) as AiSuggestionsResponseDto;
  return { kind: 'ok', data };
}
