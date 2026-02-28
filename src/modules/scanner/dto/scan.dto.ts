import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';

export enum ScanType {
  TICKET = 'ticket',
  REGISTRATION = 'registration',
  DONATION = 'donation',
}

export class ScanDto {
  @ApiProperty({ description: 'QR Code to scan' })
  @IsString()
  qrCode: string;

  @ApiProperty({
    description: 'Mark as used (requires permission)',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  markAsUsed?: boolean = false;

  @ApiProperty({
    description: 'Scan type (auto-detected if not provided)',
    required: false,
    enum: ScanType,
  })
  @IsEnum(ScanType)
  @IsOptional()
  scanType?: ScanType;

  @ApiProperty({ description: 'Location of scan', required: false })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiProperty({ description: 'Additional notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ScanResultDto {
  success: boolean;
  message: string;
  data?: {
    type: ScanType;
    id: string;
    eventId: string;
    eventName: string;
    eventDate?: Date;
    userName: string;
    userEmail?: string;
    status: string;
    isUsed: boolean;
    transactionId?: string;
    permissions?: {
      canMarkUsed: boolean;
      canViewDetails: boolean;
    };
    scannedAt?: Date;
    scanLocation?: string;
    scannedBy?: string;
    qrCode: string;
  };
  error?: string;
}

export class BulkScanDto {
  @ApiProperty({
    description: 'List of scans to process',
    example: [
      { qrCode: 'qr123', markAsUsed: true },
      { qrCode: 'qr456', markAsUsed: false },
    ],
  })
  scans: Array<{
    qrCode: string;
    markAsUsed?: boolean;
  }>;
}

export class ValidationResultDto {
  isValid: boolean;
  canMarkUsed: boolean;
  message: string;
  data?: {
    type: ScanType;
    id: string;
    eventId: string;
    eventName: string;
    eventDate?: Date;
    userName: string;
    status: string;
    isUsed: boolean;
    transactionId?: string;
  };
}

export class QuickScanResultDto {
  isValid: boolean;
  canMarkUsed: boolean;
  message: string;
  type?: ScanType;
  eventName?: string;
  userName?: string;
  eventDate?: Date;
  qrCode: string;
}
