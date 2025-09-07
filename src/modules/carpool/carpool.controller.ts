import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { CarpoolService } from './carpool.service';
import { CreateCarpoolDto } from './dto/create-carpool.dto';
import { UpdateCarpoolDto } from './dto/update-carpool.dto';
import { JoinCarpoolDto } from './dto/join-carpool.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RespondRequestDto } from './dto/respond-request.dto';
import { QueryCarpoolDto } from './dto/query-carpool.dto';
import { ForYouCarpoolDto } from './dto/foryou-carpool.dto';


@ApiTags('Carpool')
@Controller('carpool')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CarpoolController {
  constructor(private readonly carpoolService: CarpoolService) {}


  @Post()
  @ApiOperation({ summary: 'Create a carpool' })
  create(@CurrentUser('id') userId: string,@Body() createCarpoolDto: CreateCarpoolDto) {
    return this.carpoolService.create(userId,createCarpoolDto);
  }

  @Get('for-you')
  @ApiOperation({ summary: 'Get for you carpool' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  async getForyouCarpools(@CurrentUser('id') userId: string,@Query() query:ForYouCarpoolDto) {
    return this.carpoolService.getForYouCarpools(userId,query);
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

  @ApiOperation({ summary: 'Get carpool' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.carpoolService.findOne(id);
  }

  @ApiOperation({ summary: 'update carpool' })
  @Patch(':id')
  update(@CurrentUser('id') userId: string,@Param('id') id: string, @Body() updateCarpoolDto: UpdateCarpoolDto) {
    return this.carpoolService.update(userId,id, updateCarpoolDto);
  }

  @ApiOperation({ summary: 'delete carpool' })

  @Delete(':id')
  remove(@CurrentUser('id') userId: string,@Param('id') id: string) {
    return this.carpoolService.remove(userId,id);
  }

 
  @ApiOperation({ summary: 'request ride' })
  @Post(':carpoolId/request')
  requestRide(@CurrentUser('id') userId: string, @Param('carpoolId') carpoolId: string) {
    return this.carpoolService.requestRide(userId, carpoolId);
  }


  @ApiOperation({ summary: 'respond to ride request' })
  @Post('passenger/:requestId/respond')
  respondToRequest(
    @CurrentUser('id') driverId: string,
    @Param('requestId') requestId: string,
    @Body() action: RespondRequestDto,
  ) {

    return this.carpoolService.respondToRequest(driverId, requestId, action);
  }

  @Post(':id/leave')
  @ApiOperation({ summary: 'Leave a ride as a passenger' })
  async leaveRide(@Param('id') carpoolId: string, @CurrentUser('id') userId: string) {
    return this.carpoolService.leaveRide(carpoolId, userId);
  }

  @Post(':id/remove/:requestId')
  @ApiOperation({ summary: 'Remove a passenger as driver' })
  async removePassenger(
    @Param('requestId') requestId: string,
    @CurrentUser('id') driverId: string,
  ) {
    return this.carpoolService.removePassenger(driverId, requestId);
  }

  


 
}
