import type { LlmService } from '../ai/llm.service';
import type { LlmChatOptions } from '../ai/llm-provider.interface';
import {
  LlmUnavailableError,
  callAndParseCategoryProposals,
} from './llm-output.helpers';

function makeLlmService(
  chat: jest.Mock,
): Pick<LlmService, 'chat'> & { chat: jest.Mock } {
  return { chat } as unknown as Pick<LlmService, 'chat'> & { chat: jest.Mock };
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
