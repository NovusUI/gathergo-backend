import { ApiProperty } from '@nestjs/swagger';

export class ScanTicketDto {
  @ApiProperty({ description: 'QR code string to verify' })
  qrCode: string;
}
