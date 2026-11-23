import {
  CHARACTER_IMPORT_LABEL,
  buildCharacterImportButton,
  buildCharacterImportUrl,
  resolveCharacterImportUrl,
} from './character-import-link.helpers';

function settings(url: string | null) {
  return { getTrustedClientUrl: jest.fn().mockResolvedValue(url) };
}

describe('character-import-link helpers (ROK-2294)', () => {
  it('resolves to undefined when no trusted client URL is configured', async () => {
    await expect(resolveCharacterImportUrl(settings(null), 7)).resolves.toBe(
      undefined,
    );
  });

  it('strips trailing slashes and appends the game id', async () => {
    await expect(
      resolveCharacterImportUrl(settings('https://raid.example.com//'), 7),
    ).resolves.toBe(
      'https://raid.example.com/profile/gaming/characters?game=7',
    );
  });

  it('omits ?game= when the game is unknown', () => {
    expect(buildCharacterImportUrl('https://raid.example.com', null)).toBe(
      'https://raid.example.com/profile/gaming/characters',
    );
  });

  it('builds a Link-style button with the exact label and URL', () => {
    const url = 'https://raid.example.com/profile/gaming/characters?game=7';
    expect(buildCharacterImportButton(url).toJSON()).toEqual({
      type: 2,
      style: 5,
      label: CHARACTER_IMPORT_LABEL,
      url,
    });
    expect(CHARACTER_IMPORT_LABEL).toBe("Don't see your character? Import it");
  });
});
