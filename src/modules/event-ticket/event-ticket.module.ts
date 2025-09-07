import { Module } from '@nestjs/common';
import { EventTicketService } from './event-ticket.service';
import { EventTicketController } from './event-ticket.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EventTicketController],
  providers: [EventTicketService],
})
export class EventTicketModule {}
