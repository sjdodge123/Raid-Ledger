import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../../auth/admin.guard';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginInfoDto } from '@raid-ledger/contract';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function validateSlug(slug: string): string {
  if (!slug || slug.length > 100 || !SLUG_PATTERN.test(slug)) {
    throw new BadRequestException(
      'Plugin slug must be 2-100 lowercase alphanumeric characters or hyphens',
    );
  }
  return slug;
}

@Controller('admin/plugins')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class PluginAdminController {
  private readonly logger = new Logger(PluginAdminController.name);

  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  @Get()
  async listPlugins(): Promise<{ data: PluginInfoDto[] }> {
    const data = await this.pluginRegistry.listPlugins();
    return { data };
  }

  @Post(':slug/install')
  @HttpCode(HttpStatus.OK)
  async install(
    @Param('slug') slug: string,
  ): Promise<{ success: boolean; message: string }> {
    validateSlug(slug);
    await this.pluginRegistry.install(slug);
    this.logger.log(`Plugin "${slug}" installed via admin API`);
    return {
      success: true,
      message: `Plugin "${slug}" installed and activated.`,
    };
  }

  @Post(':slug/uninstall')
  @HttpCode(HttpStatus.OK)
  async uninstall(
    @Param('slug') slug: string,
  ): Promise<{ success: boolean; message: string }> {
    validateSlug(slug);
    await this.pluginRegistry.uninstall(slug);
    this.logger.log(`Plugin "${slug}" uninstalled via admin API`);
    return { success: true, message: `Plugin "${slug}" uninstalled.` };
  }

  @Post(':slug/activate')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Param('slug') slug: string,
  ): Promise<{ success: boolean; message: string }> {
    validateSlug(slug);
    await this.pluginRegistry.activate(slug);
    this.logger.log(`Plugin "${slug}" activated via admin API`);
    return { success: true, message: `Plugin "${slug}" activated.` };
  }

  @Post(':slug/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('slug') slug: string,
  ): Promise<{ success: boolean; message: string }> {
    validateSlug(slug);
    await this.pluginRegistry.deactivate(slug);
    this.logger.log(`Plugin "${slug}" deactivated via admin API`);
    return { success: true, message: `Plugin "${slug}" deactivated.` };
  }
}
