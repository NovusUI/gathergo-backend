import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class VerificationArtifactDto {
  @ApiPropertyOptional({ example: 'firebase_pnv' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ example: 'eyJhbGciOi...' })
  @IsOptional()
  @IsString()
  idToken?: string;

  @ApiPropertyOptional({ example: 'pnv-session-123' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ example: 'verification-id' })
  @IsOptional()
  @IsString()
  verificationId?: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  smsCode?: string;
}

class DeviceInfoDto {
  @ApiPropertyOptional({ example: 'android' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ example: '14' })
  @IsOptional()
  @IsString()
  osVersion?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ example: 'Pixel 7' })
  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class PhoneFirebaseTokenDto {
  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/i, {
    message: 'phoneNumber must be in E.164 format',
  })
  phoneNumber: string;

  @ApiProperty({ type: VerificationArtifactDto })
  @IsObject()
  @ValidateNested()
  @Type(() => VerificationArtifactDto)
  verificationArtifact: VerificationArtifactDto;

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  deviceInfo?: DeviceInfoDto;
}

