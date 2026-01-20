import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { CreateDonationDto } from './dto/create-donation.dto';
import { DonationService } from './donation.service';

@ApiTags('Donations')
@Controller('donations')
@UsePipes(new ValidationPipe({ transform: true }))
export class DonationController {
  constructor(private readonly donationService: DonationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new donation' })
  @ApiBody({ type: CreateDonationDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid donation data or amount below minimum',
  })
  @ApiResponse({
    status: 404,
    description: 'Event not found',
  })
  async createDonation(
    @Body() createDonationDto: CreateDonationDto,
    @Body('userId') userId: string,
  ) {
    // Note: In a real app, userId should come from JWT token or auth middleware
    // For now, we'll accept it in the request body
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    // return this.donationService.createDonation(createDonationDto, userId);
  }

  @Get('event/:eventId')
  @ApiOperation({ summary: 'Get all donations for an event' })
  @ApiParam({
    name: 'eventId',
    description: 'Event ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 404,
    description: 'Event not found',
  })
  async getEventDonations(@Param('eventId') eventId: string) {
    return this.donationService.getEventDonations(eventId);
  }
}
