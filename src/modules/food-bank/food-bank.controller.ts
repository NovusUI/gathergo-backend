import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { FoodBankService } from './food-bank.service';
import {
  UpdateCollectionDto,
  RescheduleCollectionDto,
} from './dto/collection.dto';

@ApiTags('Food bank')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FoodBankController {
  constructor(private readonly foodBank: FoodBankService) {}
  @Post('events/:eventId/food-bank/claim')
  claim(@CurrentUser('id') userId: string, @Param('eventId') eventId: string) {
    return this.foodBank.claim(userId, eventId);
  }
  @Get('events/:eventId/food-bank/me')
  mine(@CurrentUser('id') userId: string, @Param('eventId') eventId: string) {
    return this.foodBank.mine(userId, eventId);
  }
  @Get('events/:eventId/food-bank/collection')
  collection(
    @CurrentUser('id') userId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.foodBank.collection(userId, eventId);
  }
  @Patch('events/:eventId/food-bank/collection')
  updateCollection(
    @CurrentUser('id') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.foodBank.updateCollection(userId, eventId, dto);
  }
  @Post('events/:eventId/food-bank/reschedule')
  reschedule(
    @CurrentUser('id') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: RescheduleCollectionDto,
  ) {
    return this.foodBank.reschedule(userId, eventId, dto);
  }
  @Get('food-bank/my-passes')
  myPasses(@CurrentUser('id') userId: string) {
    return this.foodBank.myPasses(userId);
  }
}
