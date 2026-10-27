/**
 * ROK-1955 L4 — Devices API service (owner-only list / rename / revoke and
 * the device self view). Ownership itself is the repository's conditional
 * UPDATE (integration, T-API-23); here: a no-row answer is the one 404, a
 * bad rename body is 400 before any write, and DTOs never carry a hash.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CompanionDevicesService } from './companion-devices.service';
import type { CompanionDevicesRepository } from './companion-devices.repository';
import type { CompanionDeviceRow } from './companion-device-dto.helpers';

const row: CompanionDeviceRow = {
  id: 5,
  userId: 2,
  name: 'Gaming-PC',
  os: 'windows',
  osVersion: '11',
  appVersion: '0.1.0',
  tokenHash: 'a'.repeat(64),
  tokenHint: 'ab12',
  scope: 'companion:ingest',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  lastUsedAt: null,
  lastUsedIpCoarse: null,
  revokedAt: null,
};

function setup() {
  const repo = {
    listForUser: jest.fn().mockResolvedValue([row]),
    rename: jest.fn().mockResolvedValue(null),
    revoke: jest.fn().mockResolvedValue(false),
    findById: jest.fn().mockResolvedValue(row),
  };
  const service = new CompanionDevicesService(
    repo as unknown as CompanionDevicesRepository,
  );
  return { repo, service };
}

describe('CompanionDevicesService', () => {
  it('list maps rows to strict DTOs without the token hash', async () => {
    const { service, repo } = setup();
    const res = await service.list(2);
    expect(repo.listForUser).toHaveBeenCalledWith(2);
    expect(res.data).toHaveLength(1);
    expect(JSON.stringify(res)).not.toContain('tokenHash');
    expect(JSON.stringify(res)).not.toContain('a'.repeat(64));
    expect(res.data[0]?.state).toBe('active');
  });

  it('rename of a device the user does not own (no row) is 404 not_found', async () => {
    const { service } = setup();
    const err = await service
      .rename(9, 5, { name: 'X' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: 'not_found',
    });
  });

  it('rename with an invalid body is 400 and writes nothing', async () => {
    const { service, repo } = setup();
    await expect(service.rename(2, 5, { name: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.rename).not.toHaveBeenCalled();
  });

  it('rename returns the renamed device', async () => {
    const { service, repo } = setup();
    repo.rename.mockResolvedValue({ ...row, name: 'Laptop' });
    await expect(
      service.rename(2, 5, { name: 'Laptop' }),
    ).resolves.toMatchObject({
      id: 5,
      name: 'Laptop',
    });
    expect(repo.rename).toHaveBeenCalledWith(2, 5, 'Laptop');
  });

  it('revoke of a foreign or already-revoked device is 404 not_found', async () => {
    const { service } = setup();
    await expect(service.revoke(9, 5)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('self returns only deviceId, name and createdAt', async () => {
    const { service } = setup();
    await expect(
      service.self({ deviceId: 5, userId: 2, tokenHash: row.tokenHash }),
    ).resolves.toEqual({
      deviceId: 5,
      name: 'Gaming-PC',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
  });
});
