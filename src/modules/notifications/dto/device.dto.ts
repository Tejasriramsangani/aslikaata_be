import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicePlatform } from '../schemas/device-token.schema.js';

export class RegisterDeviceDto {
  /** FCM registration token from the Capacitor push-notifications plugin. */
  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  token: string;

  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}

export class UnregisterDeviceDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  token: string;
}
