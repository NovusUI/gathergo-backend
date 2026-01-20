import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateEventTicketDto } from '../event-ticket/dto/create-event-ticket.dto';

enum RegistrationType {
  TICKET = 'ticket',
  REGISTRATION = 'registration',
}

@ApiTags('Events')
@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  private parseFlatTicketFields(body: any): CreateEventTicketDto[] {
    console.log(body);
    const ticketFields = Object.keys(body).filter((key) =>
      key.startsWith('tickets.'),
    );

    if (ticketFields.length === 0) {
      return [];
    }

    const ticketsByIndex: { [index: number]: any } = {};

    ticketFields.forEach((field) => {
      const parts = field.split('.');
      if (parts.length < 2) return;

      const property = parts[1];
      const index = parts[2] ? parseInt(parts[2]) : 0;

      if (!ticketsByIndex[index]) {
        ticketsByIndex[index] = {};
      }

      ticketsByIndex[index][property] = body[field];
    });

    return Object.values(ticketsByIndex)
      .filter((ticket) => ticket.description && ticket.type)
      .map((ticket) => ({
        description: String(ticket.description || ''),
        price: ticket.price ? Number(ticket.price) : 0,
        quantity: ticket.quantity ? Number(ticket.quantity) : 0,
        type: String(ticket.type || ''),
        perks: this.parsePerks(ticket.perks),
      }));
  }

  private parsePerks(perks: any): string[] {
    if (!perks) return [];

    if (Array.isArray(perks)) return perks;

    if (typeof perks === 'string') {
      try {
        if (perks.startsWith('[') && perks.endsWith(']')) {
          return JSON.parse(perks);
        }
        return [perks];
      } catch {
        return [perks];
      }
    }

    return [];
  }

  @Post()
  @ApiOperation({ summary: 'Create an event' })
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('imageFile'))
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEventDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // console.log(dto)
    // // Handle flat form fields for tickets
    // if (dto.registrationType === RegistrationType.TICKET && (!dto.tickets || dto.tickets.length === 0)) {
    //   dto.tickets = this.parseFlatTicketFields(req.body);
    // }

    return this.eventService.create(userId, dto, file);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an event' })
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('imageFile'))
  async update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateEventDto,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // console.log(dto)
    // // Handle flat form fields for tickets
    // if (dto.registrationType === RegistrationType.TICKET && (!dto.tickets || dto.tickets.length === 0)) {
    //   dto.tickets = this.parseFlatTicketFields(req.body);
    // }

    return this.eventService.update(userId, id, dto, file);
  }

  // @Get()
  // @ApiOperation({ summary: 'Get all events' })
  // findAll() {
  //   return this.eventService.findAll();
  // }

  @Get('for-you')
  @ApiOperation({ summary: 'Get personalized "For You" events' })
  @ApiResponse({ status: 200, description: 'List of recommended events' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getForYouEvents(@CurrentUser('id') userId: string) {
    return this.eventService.getForYouEvents(userId);
  }
  @Get()
  @ApiOperation({ summary: 'Get user events' })
  @ApiResponse({ status: 200, description: 'List of paginated user events' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiQuery({
    name: 'userId',
    required: false,
    description: 'Target user ID (defaults to current user)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Page size (default: 10)',
  })
  async getAllUsersEvents(
    @CurrentUser('id') userId: string,
    @Query('userId') id?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.eventService.getAllUserEvents(id || userId, page, pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single event' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.eventService.findOne(id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an event' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.eventService.remove(userId, id);
  }

  @Get(':id/image-status')
  @ApiOperation({
    summary: 'Check image upload status for an event',
    description:
      'Returns the current image upload status including processing flag',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns image upload status with processing information',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            eventId: { type: 'string' },
            hasImage: { type: 'boolean' },
            isProcessing: { type: 'boolean' },
            imageUrl: { type: 'string', nullable: true },
            thumbnailUrl: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Event not found',
  })
  async getImageStatus(@Param('id') id: string) {
    const result = await this.eventService.getImageStatus(id);
    return {
      success: true,
      message: 'Image status retrieved successfully',
      data: result,
    };
  }
}
