import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const ALLOWED_MAGIC_BYTES: Array<{ type: string; bytes: number[] }> = [
  { type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] }, // 89504E47
  { type: 'jpeg', bytes: [0xff, 0xd8, 0xff] }, // FFD8FF
  { type: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF (WebP starts with RIFF...WEBP)
  { type: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
];

const MAX_UPLOADS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_SECONDS = 3600;

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly uploadDir: string;

  constructor(
    private configService: ConfigService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {
    const envDir = this.configService.get<string>('AVATAR_UPLOAD_DIR');
    if (envDir) {
      this.uploadDir = envDir;
    } else {
      const isProduction =
        this.configService.get<string>('NODE_ENV') === 'production';
      this.uploadDir = isProduction
        ? '/data/avatars'
        : path.join(process.cwd(), 'uploads', 'avatars');
    }
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  /**
   * Get the absolute upload directory path (for static file serving).
   */
  getUploadDir(): string {
    return this.uploadDir;
  }

  /**
   * Validate magic bytes and process image to 256x256 WebP.
   */
  async validateAndProcess(buffer: Buffer): Promise<Buffer> {
    if (!this.isValidImage(buffer)) {
      throw new BadRequestException(
        'Invalid image file. Supported formats: PNG, JPEG, WebP, GIF',
      );
    }

    return sharp(buffer)
      .resize(256, 256, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();
  }

  /**
   * Save processed avatar to disk, returning the relative URL path.
   */
  async save(userId: number, buffer: Buffer): Promise<string> {
    const randomHex = crypto.randomBytes(8).toString('hex');
    const filename = `${userId}-${randomHex}.webp`;
    const filePath = path.join(this.uploadDir, filename);
    await fs.promises.writeFile(filePath, buffer);
    return `/avatars/${filename}`;
  }

  /**
   * Delete an avatar file by its relative URL path.
   */
  async delete(relativePath: string): Promise<void> {
    const filename = path.basename(relativePath);
    const filePath = path.join(this.uploadDir, filename);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Failed to delete avatar file: ${filePath}`, err);
      }
    }
  }

  /**
   * Redis-based rate limit: 5 uploads/hour/user.
   */
  async checkRateLimit(userId: number): Promise<void> {
    const key = `avatar-upload:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    if (count > MAX_UPLOADS_PER_HOUR) {
      throw new HttpException(
        'Too many avatar uploads. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private isValidImage(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;

    for (const magic of ALLOWED_MAGIC_BYTES) {
      const match = magic.bytes.every((b, i) => buffer[i] === b);
      if (match) {
        // WebP needs additional check: bytes 8-11 should be WEBP
        if (magic.type === 'webp') {
          return (
            buffer[8] === 0x57 &&
            buffer[9] === 0x45 &&
            buffer[10] === 0x42 &&
            buffer[11] === 0x50
          );
        }
        return true;
      }
    }
    return false;
  }
}
