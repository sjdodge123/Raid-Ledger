import { Test } from '@nestjs/testing';
import { OllamaModelService } from './ollama-model.service';
import { SettingsService } from '../../settings/settings.service';
import * as helpers from './ollama.helpers';

jest.mock('./ollama.helpers', () => ({
  ...jest.requireActual('./ollama.helpers'),
  fetchOllama: jest.fn(),
}));

const mockFetch = helpers.fetchOllama as jest.Mock;

describe('OllamaModelService', () => {
  let service: OllamaModelService;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn().mockResolvedValue(null) };
    const module = await Test.createTestingModule({
      providers: [
        OllamaModelService,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    service = module.get(OllamaModelService);
    jest.clearAllMocks();
  });

  describe('pullModel', () => {
    it('sends a pull request to Ollama', async () => {
      mockFetch.mockResolvedValue({ status: 'success' });
      await service.pullModel('llama3.2:3b');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        '/api/pull',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('includes model name in the request body', async () => {
      mockFetch.mockResolvedValue({ status: 'success' });
      await service.pullModel('mistral:latest');
      const body = JSON.parse(
        (mockFetch.mock.calls[0][2] as { body: string }).body,
      );
      expect(body.name).toBe('mistral:latest');
      expect(body.stream).toBe(false);
    });
  });

  describe('deleteModel', () => {
    it('sends a delete request to Ollama', async () => {
      mockFetch.mockResolvedValue({});
      await service.deleteModel('llama3.2:3b');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        '/api/delete',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('isModelAvailable', () => {
    it('returns true when model is in the list', async () => {
      mockFetch.mockResolvedValue({
        models: [{ name: 'llama3.2:3b', model: 'llama3.2:3b' }],
      });
      expect(await service.isModelAvailable('llama3.2:3b')).toBe(true);
    });

    it('returns false when model is not in the list', async () => {
      mockFetch.mockResolvedValue({ models: [] });
      expect(await service.isModelAvailable('llama3.2:3b')).toBe(false);
    });

    it('returns false when API call fails', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      expect(await service.isModelAvailable('llama3.2:3b')).toBe(false);
    });
  });
});
