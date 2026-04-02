import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { CarpoolService } from './carpool.service';
import { CreateCarpoolDto } from './dto/create-carpool.dto';
import { UpdateCarpoolDto } from './dto/update-carpool.dto';
import { JoinCarpoolDto } from './dto/join-carpool.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RespondRequestDto } from './dto/respond-request.dto';
import { QueryCarpoolDto } from './dto/query-carpool.dto';
import { ForYouCarpoolDto } from './dto/foryou-carpool.dto';
import { EventCarpoolQueryDto } from './dto/event-carpool-query.dto';

@ApiTags('Carpool')
@Controller('carpool')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CarpoolController {
  constructor(private readonly carpoolService: CarpoolService) {}

  @Post()
  @ApiOperation({ summary: 'Create a carpool' })
  create(
    @CurrentUser('id') userId: string,
    @Body() createCarpoolDto: CreateCarpoolDto,
  ) {
    return this.carpoolService.create(userId, createCarpoolDto);
  }

  @Get('for-you')
  @ApiOperation({ summary: 'Get for you carpool' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  async getForyouCarpools(
    @CurrentUser('id') userId: string,
    @Query() query: ForYouCarpoolDto,
  ) {
    return this.carpoolService.getForYouCarpools(userId, query);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active carpool' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  @ApiQuery({ name: 'eventId', required: true })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  async getActiveCarpools(@Query() query: QueryCarpoolDto) {
    return this.carpoolService.getActiveCarpools(query);
  }

  @Get('event/:eventId/paginated')
  @ApiOperation({ summary: 'Get paginated event carpools with ranking' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  @ApiQuery({
    name: 'maxDistanceKm',
    required: false,
    type: Number,
    example: 10,
  })
  @ApiQuery({
    name: 'filter',
    required: false,
    enum: ['all', 'close_to_you', 'followed'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  async getPaginatedEventCarpools(
    @CurrentUser('id') userId: string,
    @Param('eventId') eventId: string,
    @Query() query: EventCarpoolQueryDto,
  ) {
    return this.carpoolService.getPaginatedEventCarpools(
      userId,
      eventId,
      query,
    );
  }

  @ApiOperation({ summary: 'Get carpool' })
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.carpoolService.findOne(id, userId);
  }

  @ApiOperation({ summary: 'update carpool' })
  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() updateCarpoolDto: UpdateCarpoolDto,
  ) {
    return this.carpoolService.update(userId, id, updateCarpoolDto);
  }

  @ApiOperation({ summary: 'delete carpool' })
  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.carpoolService.remove(userId, id);
  }

  @ApiOperation({ summary: 'request ride' })
  @Post(':carpoolId/request')
  requestRide(
    @CurrentUser('id') userId: string,
    @CurrentUser('username') username: string,
    @Param('carpoolId') carpoolId: string,
    @Body() joinRideDto: JoinCarpoolDto,
  ) {

    console.log(joinRideDto,carpoolId,userId,username)
    return this.carpoolService.requestRide(
      userId,
      carpoolId,
      joinRideDto,
      username,
    );
  }

  @ApiOperation({ summary: 'Leave a ride as a passenger' })
  @Patch('leave/:carpoolId')
  async leaveRide(
    @Param('carpoolId') carpoolId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('username') username: string,
  ) {
    return this.carpoolService.leaveRide(carpoolId, userId, username);
  }

  @ApiOperation({ summary: 'respond to ride request' })
  @Patch('passenger/:requestId/respond')
  respondToRequest(
    @CurrentUser('id') driverId: string,
    @Param('requestId') requestId: string,
    @Body() action: RespondRequestDto,
  ) {
    return this.carpoolService.respondToRequest(driverId, requestId, action);
  }

  @ApiOperation({ summary: 'Remove a passenger as driver' })
  @Patch('passenger/remove/:requestId')
  async removePassenger(
    @Param('requestId') requestId: string,
    @CurrentUser('id') driverId: string,
  ) {
    return this.carpoolService.removePassenger(driverId, requestId);
  }

  @Get(':id/chat-access')
  async getCarpoolChatAccess(
    @Param('id') carpoolId: string,
    @CurrentUser('id') id: string,
  ) {
    return this.carpoolService.getCarpoolChatAccess(carpoolId, id);
  }

  @Post(':carpoolId/request-after-cancel')
  async requestRideAfterCancel(
    @Param('carpoolId') carpoolId: string,
    @Body() data: { cancelCarpoolId: string } & JoinCarpoolDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('username') username: string,
  ) {
    return this.carpoolService.requestRideAfterCancel(
      userId,
      carpoolId,
      data,
      username,
    );
  }
}
