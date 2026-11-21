/**
 * ROK-2284 — admin GET/PUT for the sign-in reminder DMs: the on/off switch
 * (ruled Q6), the cadence in weeks and the maximum (ruled Q5). The cron reads
 * them every tick, so a save applies from the next hour.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  SigninReminderSettingsSchema,
  type SigninReminderSettingsDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../../auth/admin.guard';
import { SETTING_KEYS } from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import {
  readSigninReminderSettings,
  type SigninReminderSettingsStore,
} from './signin-reminder.settings';

/** Validate (weeks 1–12, max 1–10) and store all three settings. */
export async function writeSigninReminderSettings(
  store: SigninReminderSettingsStore,
  body: unknown,
): Promise<SigninReminderSettingsDto> {
  const parsed = SigninReminderSettingsSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      'enabled must be true/false, weeks a whole number 1–12, max 1–10',
    );
  }
  const { enabled, weeks, max } = parsed.data;
  await store.set(SETTING_KEYS.SIGNIN_REMINDER_ENABLED, String(enabled));
  await store.set(SETTING_KEYS.SIGNIN_REMINDER_WEEKS, String(weeks));
  await store.set(SETTING_KEYS.SIGNIN_REMINDER_MAX, String(max));
  return readSigninReminderSettings(store);
}

@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class SigninReminderSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('signin-reminder')
  getSettings(): Promise<SigninReminderSettingsDto> {
    return readSigninReminderSettings(this.settings);
  }

  @Put('signin-reminder')
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() body: unknown): Promise<SigninReminderSettingsDto> {
    return writeSigninReminderSettings(this.settings, body);
  }
}
