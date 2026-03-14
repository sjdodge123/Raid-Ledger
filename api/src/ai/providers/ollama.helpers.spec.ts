import {
  mapOllamaModel,
  mapOllamaChatResponse,
  mapOllamaGenerateResponse,
} from './ollama.helpers';

describe('ollama.helpers', () => {
  describe('mapOllamaModel', () => {
    it('maps a raw model to LlmModelInfo', () => {
      const result = mapOllamaModel({
        name: 'llama3.2:3b',
        model: 'llama3.2:3b',
        details: {
          parameter_size: '3B',
          quantization_level: 'Q4_K_M',
          family: 'llama',
        },
      });
      expect(result).toEqual({
        id: 'llama3.2:3b',
        name: 'llama3.2:3b',
        provider: 'ollama',
        capabilities: ['llama'],
      });
    });

    it('handles missing details gracefully', () => {
      const result = mapOllamaModel({
        name: 'custom',
        model: 'custom',
      });
      expect(result).toEqual({
        id: 'custom',
        name: 'custom',
        provider: 'ollama',
        capabilities: undefined,
      });
    });
  });

  describe('mapOllamaChatResponse', () => {
    it('maps a raw chat response with usage', () => {
      const result = mapOllamaChatResponse(
        {
          message: { content: 'Hello' },
          prompt_eval_count: 10,
          eval_count: 5,
        },
        150,
      );
      expect(result).toEqual({
        content: 'Hello',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 150,
      });
    });

    it('handles missing content and usage', () => {
      const result = mapOllamaChatResponse({}, 100);
      expect(result).toEqual({
        content: '',
        usage: undefined,
        latencyMs: 100,
      });
    });
  });

  describe('mapOllamaGenerateResponse', () => {
    it('maps a raw generate response', () => {
      const result = mapOllamaGenerateResponse(
        {
          response: 'Generated text',
          prompt_eval_count: 20,
          eval_count: 15,
        },
        200,
      );
      expect(result).toEqual({
        content: 'Generated text',
        usage: { promptTokens: 20, completionTokens: 15 },
        latencyMs: 200,
      });
    });

    it('handles missing response field', () => {
      const result = mapOllamaGenerateResponse({}, 50);
      expect(result).toEqual({
        content: '',
        usage: undefined,
        latencyMs: 50,
      });
    });
  });
});
