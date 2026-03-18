import {
  Controller,
  Patch,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';

/** Allowed MIME types and their magic bytes for logo validation */
const ALLOWED_TYPES: Record<string, { ext: string; magic: number[] }> = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
  'image/svg+xml': { ext: 'svg', magic: [0x3c] }, // '<'
};

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB

function getBrandingDir(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction
    ? '/data/uploads/branding'
    : path.join(process.cwd(), 'uploads', 'branding');
}

/** Build Multer storage configuration for logo upload. */
function buildLogoStorage() {
  return diskStorage({
    destination: (
      _req: unknown,
      _file: unknown,
      cb: (e: null, d: string) => void,
    ) => {
      const dir = getBrandingDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (
      _req: unknown,
      file: Express.Multer.File,
      cb: (e: null, f: string) => void,
    ) => {
      cb(null, `logo.${ALLOWED_TYPES[file.mimetype]?.ext || 'png'}`);
    },
  });
}

/** Filter uploaded files by MIME type. */
function logoFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (e: Error | null, a: boolean) => void,
) {
  if (!ALLOWED_TYPES[file.mimetype]) {
    cb(
      new BadRequestException(
        'Only PNG, JPEG, WebP, and SVG images are allowed',
      ),
      false,
    );
    return;
  }
  cb(null, true);
}

/** Build Multer options for logo upload. */
function buildLogoMulterOptions() {
  return {
    storage: buildLogoStorage(),
    limits: { fileSize: MAX_LOGO_SIZE },
    fileFilter: logoFileFilter,
  };
}

/**
 * Branding controller (ROK-271).
 * Manages community name, logo, and accent color.
 */
@Controller('admin/branding')
export class BrandingController {
  private readonly logger = new Logger(BrandingController.name);

  constructor(private readonly settingsService: SettingsService) {}

  /** Format branding settings for API responses. */
  private async formatBranding() {
    const branding = await this.settingsService.getBranding();
    return {
      communityName: branding.communityName,
      communityLogoUrl: branding.communityLogoPath
        ? `/uploads/branding/${path.basename(branding.communityLogoPath)}`
        : null,
      communityAccentColor: branding.communityAccentColor,
    };
  }

  /**
   * Update branding text/color settings.
   * Admin-only endpoint.
   */
  @Patch()
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async updateBranding(
    @Body() body: { communityName?: string; communityAccentColor?: string },
  ) {
    if (body.communityName !== undefined) {
      const trimmed = body.communityName.trim();
      if (trimmed.length === 0 || trimmed.length > 60) {
        throw new BadRequestException('Community name must be 1-60 characters');
      }
      await this.settingsService.setCommunityName(trimmed);
    }

    if (body.communityAccentColor !== undefined) {
      const color = body.communityAccentColor.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw new BadRequestException(
          'Accent color must be a valid hex color (e.g., #10B981)',
        );
      }
      await this.settingsService.setCommunityAccentColor(color);
    }

    this.logger.log('Branding settings updated');
    return this.formatBranding();
  }

  /** Upload community logo. Admin-only endpoint with magic byte validation. */
  @Post('logo')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseInterceptors(FileInterceptor('logo', buildLogoMulterOptions()))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No logo file provided');
    this.validateMagicBytes(file);
    this.removeOldLogos(file.filename);
    await this.settingsService.setCommunityLogoPath(file.path);
    this.logger.log(`Community logo uploaded: ${file.filename}`);
    return this.formatBranding();
  }

  /** Validate that the file's magic bytes match its declared MIME type. */
  private validateMagicBytes(file: Express.Multer.File): void {
    const buffer = fs.readFileSync(file.path);
    const typeInfo = ALLOWED_TYPES[file.mimetype];
    if (!typeInfo) return;
    const magicMatch = typeInfo.magic.every((byte, i) => buffer[i] === byte);
    if (!magicMatch) {
      fs.unlinkSync(file.path);
      throw new BadRequestException(
        'File content does not match declared type',
      );
    }
  }

  /** Remove old logo files with different extensions. */
  private removeOldLogos(currentFilename: string): void {
    const dir = getBrandingDir();
    const currentExt = path.extname(currentFilename);
    for (const { ext } of Object.values(ALLOWED_TYPES)) {
      if (`.${ext}` !== currentExt) {
        const oldPath = path.join(dir, `logo.${ext}`);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }
  }

  /**
   * Reset all branding to defaults.
   * Admin-only endpoint.
   */
  @Post('reset')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async resetBranding() {
    // Remove logo file if it exists
    const branding = await this.settingsService.getBranding();
    if (
      branding.communityLogoPath &&
      fs.existsSync(branding.communityLogoPath)
    ) {
      fs.unlinkSync(branding.communityLogoPath);
    }

    await this.settingsService.clearBranding();
    this.logger.log('Branding reset to defaults');

    return {
      communityName: null,
      communityLogoUrl: null,
      communityAccentColor: null,
    };
  }
}
