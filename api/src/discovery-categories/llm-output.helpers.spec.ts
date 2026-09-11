import type { LlmService } from '../ai/llm.service';
import type { LlmChatOptions } from '../ai/llm-provider.interface';
import {
  LlmUnavailableError,
  callAndParseCategoryProposals,
} from './llm-output.helpers';

function makeLlmService(
  chat: jest.Mock,
): Pick<LlmService, 'chat'> & { chat: jest.Mock } {
  return { chat };
}

const VALID_PROPOSAL = {
  name: 'Co-op Pals',
  description: 'Four-player co-op runs for a chill Tuesday night.',
  category_type: 'community_pattern',
  theme_vector: {
    co_op: 0.9,
    pvp: -0.2,
    rpg: 0.1,
    survival: 0.3,
    strategy: 0.0,
    social: 0.6,
    mmo: 0.0,
  },
  filter_criteria: {},
  population_strategy: 'vector',
  expires_at: '2026-12-01T00:00:00Z',
};

const BASE_OPTIONS: LlmChatOptions = {
  messages: [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
  ],
  responseFormat: 'json',
};

describe('callAndParseCategoryProposals', () => {
  it('returns parsed proposals from a valid JSON array response', async () => {
    const chat = jest.fn().mockResolvedValueOnce({
      content: JSON.stringify([VALID_PROPOSAL]),
      latencyMs: 1,
    });
    const out = await callAndParseCategoryProposals(
      makeLlmService(chat) as unknown as LlmService,
      BASE_OPTIONS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Co-op Pals');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('unwraps a {proposals:[...]} object and parses', async () => {
    const chat = jest.fn().mockResolvedValueOnce({
      content: JSON.stringify({ proposals: [VALID_PROPOSAL] }),
      latencyMs: 1,
    });
    const out = await callAndParseCategoryProposals(
      makeLlmService(chat) as unknown as LlmService,
      BASE_OPTIONS,
    );
    expect(out).toHaveLength(1);
  });

  // ROK-1127 item C1 — expires_at is REQUIRED by prompt rule 10, but the Zod
  // schema had it `.nullable().optional()`, so a proposal that omitted it
  // parsed clean and landed with a null expiry: a row that never leaves the
  // Games page. The schema now rejects it, which turns a silent bad row into
  // a parse failure the retry path can actually correct.
  describe('expires_at is required (C1)', () => {
    const { expires_at: _omitted, ...NO_EXPIRY } = VALID_PROPOSAL;

    it('rejects a proposal with no expires_at instead of storing a null expiry', async () => {
      const chat = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify([NO_EXPIRY]), latencyMs: 1 });

      const out = await callAndParseCategoryProposals(
        makeLlmService(chat) as unknown as LlmService,
        BASE_OPTIONS,
      );

      // Rejected at the schema layer, so the batch is empty and the helper
      // spent its one retry rather than accepting the row.
      expect(out).toEqual([]);
      expect(chat).toHaveBeenCalledTimes(2);
    });

    it('rejects an explicit null expires_at', async () => {
      const chat = jest.fn().mockResolvedValue({
        content: JSON.stringify([{ ...VALID_PROPOSAL, expires_at: null }]),
        latencyMs: 1,
      });

      const out = await callAndParseCategoryProposals(
        makeLlmService(chat) as unknown as LlmService,
        BASE_OPTIONS,
      );

      expect(out).toEqual([]);
    });

    it('names expires_at in the retry reminder so the model can correct it', async () => {
      const chat = jest
        .fn()
        .mockResolvedValue({ content: JSON.stringify([NO_EXPIRY]), latencyMs: 1 });

      await callAndParseCategoryProposals(
        makeLlmService(chat) as unknown as LlmService,
        BASE_OPTIONS,
      );

      const retryOptions = chat.mock.calls[1]?.[0] as LlmChatOptions;
      const reminder = retryOptions.messages.at(-1);
      expect(reminder?.content).toContain('expires_at');
    });
  });

  // ROK-1127 item A3 — truncation recovery. The helper walks brace depth and
  // keeps objects that close cleanly at depth 1, so a cut-off response still
  // yields its completed proposals. Each case asserts `chat` ran ONCE: the
  // proposal came back from recovery, not from the retry.
  describe('parseArrayResilient truncation recovery', () => {
    async function parseTruncated(content: string) {
      const chat = jest.fn().mockResolvedValueOnce({ content, latencyMs: 1 });
      const out = await callAndParseCategoryProposals(
        makeLlmService(chat) as unknown as LlmService,
        BASE_OPTIONS,
      );
      return { out, chat };
    }

    it('recovers completed objects when truncated mid-object', async () => {
      const { out, chat } = await parseTruncated(
        `[${JSON.stringify(VALID_PROPOSAL)},{"name":"Half Written","category_ty`,
      );

      expect(out).toHaveLength(1);
      expect(out[0].name).toBe('Co-op Pals');
      expect(chat).toHaveBeenCalledTimes(1);
    });

    it('recovers completed objects when truncated mid-string', async () => {
      const { out, chat } = await parseTruncated(
        `[${JSON.stringify(VALID_PROPOSAL)},{"name":"An unterminated string`,
      );

      expect(out).toHaveLength(1);
      expect(chat).toHaveBeenCalledTimes(1);
    });

    it('recovers completed objects despite a completely malformed tail', async () => {
      const { out, chat } = await parseTruncated(
        `[${JSON.stringify(VALID_PROPOSAL)}, ###not json at all###`,
      );

      expect(out).toHaveLength(1);
      expect(chat).toHaveBeenCalledTimes(1);
    });
  });

  // ROK-1127 item B2 — `filter_criteria` is a plain Zod object, so the parse
  // strips every key but `genre_tags`. The generate pipeline used to read
  // `genre_ids` / `theme_ids` off an untyped cast of this field; those reads
  // could never fire, and this pins the reason they were removed.
  it('strips filter_criteria keys the schema does not declare', async () => {
    const chat = jest.fn().mockResolvedValueOnce({
      content: JSON.stringify([
        {
          ...VALID_PROPOSAL,
          filter_criteria: {
            genre_tags: ['co-op'],
            genre_ids: [31, 32],
            theme_ids: [17],
          },
        },
      ]),
      latencyMs: 1,
    });

    const out = await callAndParseCategoryProposals(
      makeLlmService(chat) as unknown as LlmService,
      BASE_OPTIONS,
    );

    expect(out[0].filter_criteria).toEqual({ genre_tags: ['co-op'] });
  });

  it('retries once on malformed output, then returns parsed proposals', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({ content: 'not json at all', latencyMs: 1 })
      .mockResolvedValueOnce({
        content: JSON.stringify([VALID_PROPOSAL]),
        latencyMs: 1,
      });
    const out = await callAndParseCategoryProposals(
      makeLlmService(chat) as unknown as LlmService,
      BASE_OPTIONS,
    );
    expect(out).toHaveLength(1);
    expect(chat).toHaveBeenCalledTimes(2);
    const retryMessages = (chat.mock.calls[1][0] as LlmChatOptions).messages;
    expect(retryMessages[retryMessages.length - 1].content).toMatch(
      /Respond ONLY with a single JSON array/,
    );
  });

  it('returns [] when both attempts are unparseable', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({ content: 'garbage', latencyMs: 1 })
      .mockResolvedValueOnce({ content: 'still garbage', latencyMs: 1 });
    const out = await callAndParseCategoryProposals(
      makeLlmService(chat) as unknown as LlmService,
      BASE_OPTIONS,
    );
    expect(out).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('throws LlmUnavailableError when the final attempt fails with provider error', async () => {
    const chat = jest
      .fn()
      .mockRejectedValueOnce(new Error('upstream 503'))
      .mockRejectedValueOnce(new Error('upstream 503'));
    await expect(
      callAndParseCategoryProposals(
        makeLlmService(chat) as unknown as LlmService,
        BASE_OPTIONS,
      ),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('drops individual invalid proposals but keeps valid ones', async () => {
    const invalid = { ...VALID_PROPOSAL, theme_vector: { co_op: 'bad' } };
    const chat = jest.fn().mockResolvedValueOnce({
      content: JSON.stringify([invalid, VALID_PROPOSAL]),
      latencyMs: 1,
    });
    const out = await callAndParseCategoryProposals(
      makeLlmService(chat) as unknown as LlmService,
      BASE_OPTIONS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Co-op Pals');
  });
});
