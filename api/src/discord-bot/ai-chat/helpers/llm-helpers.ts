import type { Logger } from '@nestjs/common';
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { LlmService } from '../../../ai/llm.service';
import {
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARY_MAX_TOKENS,
  SUMMARY_TEMPERATURE,
  LLM_FEATURE_TAG,
  CLASSIFY_PROMPT,
  mapClassification,
} from '../ai-chat.constants';
import { formatLeafResponse, formatRawFallback } from './response-formatter';
import type { AiChatResponse } from '../ai-chat.service';

/** Summarize data using the LLM service with fallback. */
export async function summarizeWithLlm(
  llmService: LlmService,
  logger: Logger,
  data: string,
  hint?: string,
): Promise<string> {
  try {
    const systemPrompt = hint
      ? `${SUMMARIZE_SYSTEM_PROMPT} ${hint}`
      : SUMMARIZE_SYSTEM_PROMPT;
    const response = await llmService.chat(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: data },
        ],
        maxTokens: SUMMARY_MAX_TOKENS,
        temperature: SUMMARY_TEMPERATURE,
      },
      { feature: LLM_FEATURE_TAG },
    );
    return formatLeafResponse(response.content);
  } catch (err) {
    logger.warn('LLM summarization failed, using raw fallback', err);
    return formatRawFallback(data);
  }
}

/** Use LLM to classify ambiguous free-text (10-token cap). */
export async function llmClassify(
  llmService: LlmService,
  text: string,
): Promise<string | null> {
  try {
    const res = await llmService.chat(
      {
        messages: [
          { role: 'system', content: CLASSIFY_PROMPT },
          { role: 'user', content: text },
        ],
        maxTokens: 10,
        temperature: 0,
      },
      { feature: LLM_FEATURE_TAG },
    );
    return mapClassification(res.content);
  } catch {
    return null;
  }
}

/** Serialize ActionRows into the simplified component format. */
export function serializeRows(
  rows: ActionRowBuilder<ButtonBuilder>[],
): { customId: string | null; label: string | null }[] {
  return rows.flatMap((row) =>
    row.components.map((c) => {
      const json = c.toJSON() as unknown as Record<string, unknown>;
      return {
        customId: (json['custom_id'] as string) ?? null,
        label: (json['label'] as string) ?? null,
      };
    }),
  );
}

/** Build a full AiChatResponse from content and rows. */
export function buildMenuResponse(
  content: string,
  rows: ActionRowBuilder<ButtonBuilder>[],
): AiChatResponse {
  return { content, embeds: [], components: serializeRows(rows), rows };
}

/** Build a text-only response with no buttons. */
export function textResponse(text: string): AiChatResponse {
  return { content: text, embeds: [], components: [], rows: [] };
}
