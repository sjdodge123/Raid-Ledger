import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { hashValheimLinkToken } from './valheim-link-token.helpers';
import type {
  ValheimLinkServerRef,
  ValheimLinkTokenStatusRow,
  ValheimLinkTokensRepository,
} from './valheim-link-tokens.repository';
import { ValheimLinkTokensService } from './valheim-link-tokens.service';

const NONE: Omit<ValheimLinkTokenStatusRow, 'pelicanServerId'> = {
  tokenHint: null,
  createdAt: null,
  rotatedAt: null,
  revokedAt: null,
  lastUsedAt: null,
};

/** An in-memory repo double holding one server's token row. */
function build(
  server: ValheimLinkServerRef | null = { id: 7, gameSlug: 'valheim' },
) {
  const state = {
    row: { pelicanServerId: 7, ...NONE },
    hash: null as string | null,
  };
  const repo = {
    findServer: jest.fn(async () => server),
    getStatus: jest.fn(async () => ({ ...state.row })),
    upsertToken: jest.fn(async (_id: number, hash: string, hint: string) => {
      state.hash = hash;
      state.row = {
        ...state.row,
        tokenHint: hint,
        createdAt: new Date(),
        revokedAt: null,
      };
    }),
    revoke: jest.fn(async () => {
      if (state.row.tokenHint === null || state.row.revokedAt) return false;
      state.row = { ...state.row, revokedAt: new Date() };
      return true;
    }),
  };
  const service = new ValheimLinkTokensService(
    repo as unknown as ValheimLinkTokensRepository,
  );
  return { service, repo, state };
}

describe('ValheimLinkTokensService (ROK-1833)', () => {
  it('issues once: the token matches the stored hash and only its hint is in status', async () => {
    const { service, state } = build();
    const issued = await service.issue(7, 1, false);
    expect(issued.token).toMatch(/^rlvl_/);
    expect(state.hash).toBe(hashValheimLinkToken(issued.token));
    expect(issued.status).toMatchObject({ state: 'active', serverId: '7' });
    expect(issued.status.tokenHint).toBe(issued.token.slice(-4));
    expect(JSON.stringify(issued.status)).not.toContain(issued.token);
  });

  it('409 on a second issue without rotate', async () => {
    const { service } = build();
    await service.issue(7, 1, false);
    await expect(service.issue(7, 1, false)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rotate replaces the hash — the old token no longer matches', async () => {
    const { service, state } = build();
    const first = await service.issue(7, 1, false);
    const second = await service.issue(7, 1, true);
    expect(second.token).not.toBe(first.token);
    expect(state.hash).toBe(hashValheimLinkToken(second.token));
    expect(state.hash).not.toBe(hashValheimLinkToken(first.token));
  });

  it('revoke flips to revoked; a second revoke is 404; re-issue is allowed', async () => {
    const { service } = build();
    await service.issue(7, 1, false);
    expect((await service.revoke(7)).state).toBe('revoked');
    await expect(service.revoke(7)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.issue(7, 1, false)).status.state).toBe('active');
  });

  it('404 for an unknown server; 400 for a row not mapped to Valheim', async () => {
    await expect(build(null).service.issue(7, 1, false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const other = build({ id: 7, gameSlug: 'palworld' });
    await expect(other.service.issue(7, 1, false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(other.service.status(7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(other.repo.upsertToken).not.toHaveBeenCalled();
  });

  it('status is none before any issue', async () => {
    expect((await build().service.status(7)).state).toBe('none');
  });
});
