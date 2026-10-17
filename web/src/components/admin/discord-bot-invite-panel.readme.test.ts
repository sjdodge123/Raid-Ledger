/**
 * ROK-1471: the README must document how to invite the bot and why re-authorising
 * is required, in the same words the admin UI uses. This guard fails if the
 * section is renamed or the install-time explanation drifts from the UI copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { INVITE_INSTALL_TIME_NOTE } from './discord-bot-invite-panel';

/** Walks up from the vitest cwd to the monorepo root (README.md + web/). */
function repoRoot(): string {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
        if (existsSync(join(dir, 'README.md')) && existsSync(join(dir, 'web'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('Could not locate the repo root from ' + process.cwd());
}

const readme = readFileSync(join(repoRoot(), 'README.md'), 'utf8');

describe('README — Discord bot permissions section (ROK-1471)', () => {
    it('documents the invite/permissions section', () => {
        expect(readme).toContain('### Discord bot permissions & inviting the bot');
    });

    it('explains the install-time permission grant in the same words as the UI', () => {
        expect(readme).toContain('install time');
        expect(readme).toContain(INVITE_INSTALL_TIME_NOTE);
    });

    it('names the thread permissions the LFG board needs', () => {
        expect(readme).toContain('Manage Threads');
        expect(readme).toContain('Create Public Threads');
        expect(readme).toContain('Send Messages in Threads');
    });
});
