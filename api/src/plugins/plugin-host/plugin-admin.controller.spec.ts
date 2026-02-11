import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PluginAdminController } from './plugin-admin.controller';
import { PluginRegistryService } from './plugin-registry.service';

describe('PluginAdminController', () => {
  let controller: PluginAdminController;
  let registry: {
    listPlugins: jest.Mock;
    install: jest.Mock;
    uninstall: jest.Mock;
    activate: jest.Mock;
    deactivate: jest.Mock;
  };

  beforeEach(async () => {
    registry = {
      listPlugins: jest.fn().mockResolvedValue([]),
      install: jest.fn().mockResolvedValue({ slug: 'test', active: true }),
      uninstall: jest.fn().mockResolvedValue(undefined),
      activate: jest.fn().mockResolvedValue(undefined),
      deactivate: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PluginAdminController],
      providers: [{ provide: PluginRegistryService, useValue: registry }],
    }).compile();

    controller = module.get<PluginAdminController>(PluginAdminController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listPlugins()', () => {
    it('should return data wrapper around registry results', async () => {
      const plugins = [{ slug: 'test', name: 'Test' }];
      registry.listPlugins.mockResolvedValue(plugins);

      const result = await controller.listPlugins();
      expect(result).toEqual({ data: plugins });
    });
  });

  describe('install()', () => {
    it('should call registry.install and return success', async () => {
      const result = await controller.install('test-plugin');
      expect(registry.install).toHaveBeenCalledWith('test-plugin');
      expect(result.success).toBe(true);
    });

    it('should propagate NotFoundException from registry', async () => {
      registry.install.mockRejectedValue(
        new NotFoundException('Plugin manifest "bad" not found'),
      );
      await expect(controller.install('bad')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject invalid slug format', async () => {
      await expect(controller.install('INVALID!')).rejects.toThrow(
        BadRequestException,
      );
      expect(registry.install).not.toHaveBeenCalled();
    });
  });

  describe('uninstall()', () => {
    it('should call registry.uninstall and return success', async () => {
      const result = await controller.uninstall('test-plugin');
      expect(registry.uninstall).toHaveBeenCalledWith('test-plugin');
      expect(result.success).toBe(true);
    });

    it('should reject invalid slug format', async () => {
      await expect(controller.uninstall('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('activate()', () => {
    it('should call registry.activate and return success', async () => {
      const result = await controller.activate('test-plugin');
      expect(registry.activate).toHaveBeenCalledWith('test-plugin');
      expect(result.success).toBe(true);
    });

    it('should reject slug exceeding max length', async () => {
      const longSlug = 'a'.repeat(101);
      await expect(controller.activate(longSlug)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deactivate()', () => {
    it('should call registry.deactivate and return success', async () => {
      const result = await controller.deactivate('test-plugin');
      expect(registry.deactivate).toHaveBeenCalledWith('test-plugin');
      expect(result.success).toBe(true);
    });

    it('should propagate BadRequestException from registry', async () => {
      registry.deactivate.mockRejectedValue(
        new BadRequestException('Must deactivate first'),
      );
      await expect(controller.deactivate('test-plugin')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
