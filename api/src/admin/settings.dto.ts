import { IsNotEmpty, IsString, IsUrl, IsOptional } from 'class-validator';
import type { IgdbHealthStatusDto } from '@raid-ledger/contract';

/**
 * DTOs and response interfaces for AdminSettingsController.
 * Extracted from settings.controller.ts for file size compliance.
 */

export interface OAuthStatusResponse {
  configured: boolean;
  callbackUrl: string | null;
}
export interface IgdbStatusResponse {
  configured: boolean;
  health?: IgdbHealthStatusDto;
}
export interface BlizzardStatusResponse {
  configured: boolean;
}
export interface OAuthTestResponse {
  success: boolean;
  message: string;
}

export class BlizzardConfigDto {
  @IsString()
  @IsNotEmpty({ message: 'Client ID is required' })
  clientId!: string;
  @IsString()
  @IsNotEmpty({ message: 'Client Secret is required' })
  clientSecret!: string;
}
export class OAuthConfigDto {
  @IsString()
  @IsNotEmpty({ message: 'Client ID is required' })
  clientId!: string;
  @IsString()
  @IsNotEmpty({ message: 'Client Secret is required' })
  clientSecret!: string;
  @IsOptional()
  @IsUrl(
    { require_tld: false },
    { message: 'Callback URL must be a valid URL' },
  )
  callbackUrl?: string;
}
export class IgdbConfigDto {
  @IsString()
  @IsNotEmpty({ message: 'Client ID is required' })
  clientId!: string;
  @IsString()
  @IsNotEmpty({ message: 'Client Secret is required' })
  clientSecret!: string;
}
export class SteamConfigDto {
  @IsString() @IsNotEmpty({ message: 'API key is required' }) apiKey!: string;
}
export class ItadConfigDto {
  @IsString() @IsNotEmpty({ message: 'API key is required' }) apiKey!: string;
}
