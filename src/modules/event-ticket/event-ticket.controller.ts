import { Body, Controller, Post, Patch, Param, Delete, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventTicketService } from './event-ticket.service';
import { CreateEventTicketDto } from './dto/create-event-ticket.dto';
import { UpdateEventTicketDto } from './dto/update-event-ticket.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@Controller('event-tickets')
@ApiTags('Event Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class EventTicketController {
  constructor(private readonly service: EventTicketService) {}

  @Post(':eventId')
  @ApiOperation({ summary: 'Create ticket type for an event' })
  create(
    @Param('eventId') eventId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEventTicketDto,
  ) {
    return this.service.create(eventId, userId, dto);
  }

  @Get(':eventId')
  @ApiOperation({ summary: 'Get all ticket types for an event' })
  findAll(@Param('eventId') eventId: string) {
    return this.service.findAll(eventId);
  }

  @Patch(':ticketId')
  @ApiOperation({ summary: 'Update a ticket type' })
  update(@CurrentUser('id') userId:string,@Param('ticketId') ticketId: string, @Body() dto: UpdateEventTicketDto) {
    return this.service.update(ticketId, userId,dto);
  }

  @Delete(':ticketId')
  @ApiOperation({ summary: 'Delete a ticket type' })
  remove(@CurrentUser('id') userId:string,@Param('ticketId') ticketId: string) {
    return this.service.remove(ticketId,userId);
  }
}
