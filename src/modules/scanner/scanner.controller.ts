import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  Request,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

import { ScannerService } from './scanner.service';
import {
  ScanDto,
  ScanResultDto,
  BulkScanDto,
  ValidationResultDto,
  QuickScanResultDto,
} from './dto/scan.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ScannerGuard } from 'src/common/guards/scanner.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('scanner')
@ApiBearerAuth()
@Controller('scanner')
@UseGuards(JwtAuthGuard, ScannerGuard)
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scan a QR code (ticket or registration)' })
  @ApiBody({ type: ScanDto })
  @ApiResponse({ status: 200, type: ScanResultDto })
  async scan(
    @Body() scanDto: ScanDto,
    @CurrentUser('id') userId: string,
  ): Promise<ScanResultDto> {
    return this.scannerService.scan(
      scanDto.qrCode,
      userId,
      scanDto.markAsUsed,
      scanDto.location,
    );
  }

  @Post('scan/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk scan multiple QR codes' })
  @ApiBody({ type: BulkScanDto })
  async bulkScan(@Body() bulkScanDto: BulkScanDto, @Request() req) {
    return this.scannerService.bulkScan(bulkScanDto.scans, req.user.id);
  }

  @Get('validate/:qrCode')
  @ApiOperation({ summary: 'Validate a QR code without marking as used' })
  @ApiResponse({ status: 200, type: ValidationResultDto })
  async validate(
    @Param('qrCode') qrCode: string,
    @Request() req,
  ): Promise<ValidationResultDto> {
    return this.scannerService.validate(qrCode, req.user.id);
  }

  @Get('quick-scan')
  @ApiOperation({
    summary: 'Quick scan - returns minimal data for fast scanning',
  })
  @ApiResponse({ status: 200, type: QuickScanResultDto })
  async quickScan(
    @Query('qrCode') qrCode: string,
    @Request() req,
  ): Promise<QuickScanResultDto> {
    return this.scannerService.quickScan(qrCode, req.user.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get scan history for current user' })
  async getScanHistory(
    @Request() req,
    @Query('eventId') eventId?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.scannerService.getScanHistory(req.user.id, {
      eventId,
      type,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get scanner statistics for current user' })
  async getScannerStats(@Request() req, @Query('eventId') eventId?: string) {
    return this.scannerService.getScannerStats(req.user.id, eventId);
  }
}
