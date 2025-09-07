import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TicketService } from './ticket.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ScanTicketDto } from './dto/scan-ticket-dto';

@Controller('tickets')
@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class TicketController {
  constructor(private readonly service: TicketService) {}

  @Post('scan')
  @ApiOperation({ summary: 'Scan and verify ticket by QR code' })
  @ApiResponse({ status: 200, description: 'Ticket verified successfully' })
  async scanTicket(@Body() dto: ScanTicketDto) {
    
    return this.service.verifyTicket(dto.qrCode);
  }

  @Post(':eventTicketId')
  @ApiOperation({ summary: 'Buy a ticket' })
  create(@Param('eventTicketId') eventTicketId: string, @CurrentUser('id') userId: string, @Body() dto: CreateTicketDto) {
    return this.service.create(eventTicketId, userId, dto);
  }

  @Get('my-tickets')
  @ApiOperation({ summary: 'Get my tickets' })
  getMyTickets(@CurrentUser('id') userId: string) {
    return this.service.getMyTickets(userId);
  }

 
}
